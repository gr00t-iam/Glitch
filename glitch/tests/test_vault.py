"""Vault contracts use temporary databases and explicitly synthetic credentials."""
import base64
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from glitch.api import DesktopAPI
from glitch.engine import AgentEngine
from glitch.orchestration import AgentCoordinator
from glitch.storage import DEFAULTS, Store

try:
    from glitch.vault import Vault
except ImportError:
    Vault = None

SYNTHETIC = 'synthetic-vault-fixture-ONLY-42'
ORIGIN = 'https://example.invalid:8443'


def fixture_cipher(value, decrypt=False):
    """Portable test codec, never a production encryption fallback."""
    return base64.b64decode(value, validate=True) if decrypt else base64.b64encode(value)


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'data')
        self.assertIsNotNone(Vault, 'Task 1 requires the encrypted Vault service')
        self.vault = Vault(self.store, cipher=fixture_cipher)
        self.store._vault = self.vault

    def save(self, **kwargs):
        return self.vault.save('Fixture connection', 'bearer', ORIGIN,
                               {'token': SYNTHETIC}, **kwargs)

    def test_encrypted_round_trip_metadata_update_and_delete(self):
        item = self.save()
        self.assertEqual(self.vault.resolve(item['id'], ORIGIN), {'token': SYNTHETIC})
        self.assertTrue(item['saved'])
        self.assertNotIn('payload', item)
        self.assertNotIn(SYNTHETIC, json.dumps(self.vault.list()))
        for file in self.store.directory.glob('glitch.sqlite3*'):
            self.assertNotIn(SYNTHETIC.encode(), file.read_bytes())
        replacement = self.vault.save('Updated', 'bearer', ORIGIN,
                                      {'token': 'synthetic-replacement-ONLY'}, item['id'])
        self.assertEqual(replacement['id'], item['id'])
        self.assertEqual(replacement['created_at'], item['created_at'])
        self.assertEqual(len(self.vault.list()), 1)
        self.vault.delete(item['id'])
        self.assertEqual(self.vault.list(), [])
        with self.assertRaises(ValueError):
            self.vault.resolve(item['id'], ORIGIN)

    @unittest.skipUnless(os.name == 'nt', 'Production DPAPI requires Windows')
    def test_production_dpapi_and_restart(self):
        vault = Vault(self.store)
        item = vault.save('DPAPI fixture', 'github', 'https://github.com', {'token': SYNTHETIC})
        reopened = Store(self.store.directory)
        self.assertEqual(reopened.vault.resolve(item['id'], 'https://github.com'), {'token': SYNTHETIC})
        self.assertNotIn(SYNTHETIC, reopened.redact('echo ' + SYNTHETIC))
        for file in self.store.directory.glob('glitch.sqlite3*'):
            self.assertNotIn(SYNTHETIC.encode(), file.read_bytes())

    @patch('glitch.storage.protect', side_effect=fixture_cipher)
    def test_additive_migration_preserves_settings_sessions_and_legacy_keys(self, _cipher):
        session = self.store.new_session(self.root)
        self.store.save_settings({'context_length': 65535})
        existing = fixture_cipher(b'synthetic-existing-setting-ONLY')
        (self.store.directory / 'supervisor.dpapi').write_bytes(existing)
        self.store.message(session, 'user', 'existing conversation')
        self.save()
        reopened = Store(self.store.directory)
        reopened._vault = Vault(reopened, cipher=fixture_cipher)
        self.assertEqual(reopened.settings()['context_length'], 65535)
        self.assertEqual(reopened.settings()['mode'], DEFAULTS['mode'])
        self.assertTrue(reopened.settings()['key_saved'])
        self.assertEqual(reopened.messages(session)[0]['content'], 'existing conversation')
        self.assertEqual((reopened.directory / 'supervisor.dpapi').read_bytes(), existing)

    def test_exact_origin_not_redirect_or_credential_url(self):
        item = self.save()
        rejected = ['http://example.invalid:8443', 'https://other.invalid:8443',
                    'https://example.invalid', ORIGIN + '/redirect',
                    ORIGIN + '/..', ORIGIN + '?token=synthetic', ORIGIN + '#fragment',
                    'https://user:synthetic@example.invalid:8443',
                    'https://example.invalid:0', 'https://example.invalid:65536',
                    'https://example.invalid:invalid', ORIGIN + '?', ORIGIN + '#',
                    'https://example.invalid\\@other.invalid', 'https://example.invalid:']
        for value in rejected:
            with self.subTest(origin=value), self.assertRaises(ValueError):
                self.vault.resolve(item['id'], value)
            if value not in ('https://other.invalid:8443', 'https://example.invalid'):
                with self.subTest(save_origin=value), self.assertRaises(ValueError):
                    self.vault.save('Invalid', 'bearer', value, {'token': SYNTHETIC})

    def test_unknown_ids_and_ciphertext_failure_are_safe(self):
        for operation in (lambda: self.vault.resolve('missing', ORIGIN),
                          lambda: self.vault.delete('missing'),
                          lambda: self.save(identifier='missing')):
            with self.assertRaises(ValueError):
                operation()
        item = self.save()
        with self.store.connect() as db:
            db.execute('UPDATE vault SET ciphertext=? WHERE id=?', (b'not-ciphertext', item['id']))
        with self.assertRaisesRegex(RuntimeError, 'unlock'):
            self.vault.resolve(item['id'], ORIGIN)
        with self.assertRaisesRegex(RuntimeError, 'unlock'):
            self.vault.redact('Do not emit output when the redactor cannot load secrets')
        self.assertNotIn('ciphertext', json.dumps(self.vault.list()))

    def test_strict_payload_types_limits_and_ca_metadata(self):
        for name, kind, origin, payload in [
            ('', 'bearer', ORIGIN, {'token': SYNTHETIC}),
            ('x' * 121, 'bearer', ORIGIN, {'token': SYNTHETIC}),
            ('Fixture', 'unknown', ORIGIN, {'token': SYNTHETIC}),
            ('Fixture', 'bearer', ORIGIN, {'token': 42}),
            ('Fixture', 'bearer', ORIGIN, {'token': ''}),
            ('Fixture', 'bearer', ORIGIN, {'token': 'x' * 16385}),
            ('Fixture', 'bearer', ORIGIN, {'token': SYNTHETIC, 'verify': False}),
            ('Fixture', 'bearer', ORIGIN, {'token': SYNTHETIC, 'ca_pem': 'not a certificate'}),
            ('Fixture', 'github', ORIGIN, {'token': SYNTHETIC}),
            ('Fixture', 'basic', ORIGIN, {'username': 'fixture', 'password': 'line\nbreak'}),
            ('Fixture', 'proxmox', ORIGIN, {'token_id': 'bad', 'secret': SYNTHETIC}),
        ]:
            with self.subTest(kind=kind, payload_type=type(payload).__name__), self.assertRaises(ValueError):
                self.vault.save(name, kind, origin, payload)
        for kind, payload in [('basic', {'username': 'fixture-user', 'password': SYNTHETIC}),
                              ('browser', {'username': 'fixture-user', 'password': SYNTHETIC}),
                              ('proxmox', {'token_id': 'fixture@pve!agent', 'secret': SYNTHETIC})]:
            item = self.vault.save(kind, kind, ORIGIN, payload)
            self.assertEqual(self.vault.resolve(item['id'], ORIGIN), payload)
            self.assertEqual(item['tls'], {'verify': True, 'custom_ca': False})

    def test_nested_exact_redaction_keys_exceptions_and_retired_values(self):
        item = self.save()
        value = {'echo': [SYNTHETIC, {'innocent': 'prefix ' + SYNTHETIC + ' suffix'}],
                 SYNTHETIC: ValueError('failed ' + SYNTHETIC), 'pair': (SYNTHETIC,)}
        self.assertNotIn(SYNTHETIC, str(self.vault.redact(value)))
        self.vault.save('Replacement', 'bearer', ORIGIN, {'token': 'synthetic-new-ONLY'}, item['id'])
        self.vault.delete(item['id'])
        self.assertNotIn(SYNTHETIC, str(self.vault.redact(value)))
        self.assertIn('[credential removed]', self.vault.redact('password=synthetic-pattern'))

    def test_storage_write_and_read_boundaries(self):
        self.save()
        session = self.store.new_session(self.root)
        self.store.message(session, 'user', 'echo ' + SYNTHETIC)
        self.store.anchor(session, 'anchor ' + SYNTHETIC)
        self.store.event(session, 'fixture', 'title ' + SYNTHETIC, {'echo': SYNTHETIC})
        self.assertNotIn(SYNTHETIC, str(self.store.messages(session)))
        self.assertNotIn(SYNTHETIC, str(self.store.anchors(session)))
        self.assertNotIn(SYNTHETIC, str(self.store.events(session, 0)))
        self.assertNotIn(SYNTHETIC, str(self.store.sessions()))
        with self.store.connect() as db:
            self.assertNotIn(SYNTHETIC, str([tuple(r) for r in db.execute('SELECT * FROM messages')]))
            db.execute('UPDATE messages SET content=?', ('historical echo ' + SYNTHETIC,))
        self.assertNotIn(SYNTHETIC, str(self.store.messages(session)))

    def test_bridge_metadata_only_and_all_response_error_redaction(self):
        engine = AgentEngine(self.store, Mock())
        models = Mock()
        api = DesktopAPI(self.store, engine, models)
        item = api.vault_save('Bridge', 'bearer', ORIGIN, {'token': SYNTHETIC})
        self.assertNotIn(SYNTHETIC, str(api.vault_list()))
        self.assertNotIn('resolve', ' '.join(n for n in dir(api) if not n.startswith('_')))
        models.status.return_value = {'message': SYNTHETIC}
        self.assertNotIn(SYNTHETIC, str(api.model_status()))
        models.supervisor.test.side_effect = RuntimeError('echo ' + SYNTHETIC)
        with self.assertRaises(Exception) as error:
            api.test_supervisor()
        self.assertNotIn(SYNTHETIC, str(error.exception))
        api.vault_delete(item['id'])
        self.assertEqual(api.vault_list(), [])

    def test_mutation_refused_for_active_child_and_pending_approval(self):
        models = Mock()
        coordinator = AgentCoordinator(self.store, models)
        child = AgentEngine(self.store, models)
        session = self.store.new_session(self.root)
        child.running_session = session
        child.pending = {'id': 'synthetic-approval', 'action': 'write_file', 'payload': {}}
        coordinator.runs['child'] = {'id': 'child', 'session': session, 'parent_id': 'parent',
                                     'role': 'Child', 'task': 'fixture', 'status': 'needs_approval',
                                     'result': '', 'engine': child}
        api = DesktopAPI(self.store, coordinator, models)
        item = self.save()
        for operation in (lambda: api.vault_save('Blocked', 'bearer', ORIGIN, {'token': SYNTHETIC}),
                          lambda: api.vault_save('Blocked', 'bearer', ORIGIN, {'token': SYNTHETIC}, item['id']),
                          lambda: api.vault_delete(item['id'])):
            with self.assertRaisesRegex(ValueError, 'Stop'):
                operation()
        self.assertEqual(len(api.vault_list()), 1)

    def test_mutation_holds_admission_lock_until_commit(self):
        coordinator = AgentCoordinator(self.store, Mock())
        api = DesktopAPI(self.store, coordinator, Mock())
        acquired = []
        def probe(*args, **kwargs):
            def contender():
                entered = coordinator.lock.acquire(blocking=False)
                acquired.append(entered)
                if entered:
                    coordinator.lock.release()
            worker = threading.Thread(target=contender)
            worker.start()
            worker.join(2)
            return {'id': 'synthetic-id'}
        with patch.object(self.vault, 'save', side_effect=probe):
            api.vault_save('Fixture', 'bearer', ORIGIN, {'token': SYNTHETIC})
        self.assertEqual(acquired, [False])

    def test_agent_descriptors_and_model_tool_exception_feedback(self):
        self.save()
        session = self.store.new_session(self.root)
        observed = []
        class Models:
            def chat(inner, settings, messages, cancel):
                observed.append(json.loads(json.dumps(messages)))
                if len(observed) == 1:
                    return {'done': False, 'message': 'echo ' + SYNTHETIC,
                            'tool': {'name': 'read_file', 'args': {'path': 'fixture.txt'}}}
                return {'done': True, 'message': 'finished', 'tool': None}
        engine = AgentEngine(self.store, Models())
        with patch('glitch.engine.WorkspaceTools.execute', side_effect=ValueError('tool echo ' + SYNTHETIC)):
            engine.run_sync(session, 'task echo ' + SYNTHETIC)
        self.assertEqual(len(observed), 2)
        self.assertNotIn(SYNTHETIC, json.dumps(observed))
        self.assertIn('Fixture connection', observed[0][0]['content'])
        self.assertIn('credential', observed[0][0]['content'].lower())
        self.assertNotIn('vault_resolve', observed[0][0]['content'])

    def test_supervisor_exact_redaction_before_serialization_and_after_response(self):
        self.save()
        from glitch.supervisor import SupervisorBridge
        settings = self.store.settings() | {'supervisor_auth': 'proxy', 'proxy_model': 'fixture'}
        self.store.proxy_token = lambda: ''
        response = Mock(ok=True)
        response.json.return_value = {'choices': [{'message': {'content': 'echo ' + SYNTHETIC}}]}
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch('glitch.supervisor.requests.post', return_value=response) as post:
            directive = SupervisorBridge(self.store).review(settings, SYNTHETIC, [{'echo': SYNTHETIC}], SYNTHETIC, threading.Event())
        self.assertNotIn(SYNTHETIC, json.dumps(post.call_args.kwargs['json']))
        self.assertNotIn(SYNTHETIC, directive)

    def test_coordinator_persistence_and_completion_callbacks(self):
        self.save()
        class Models:
            def chat(inner, *_):
                return {'done': True, 'message': 'echo ' + SYNTHETIC, 'tool': None}
        coordinator = AgentCoordinator(self.store, Models())
        delivered = []
        coordinator.subscribe_completion(delivered.append)
        session = self.store.new_session(self.root)
        identifier = coordinator.start(session, 'task ' + SYNTHETIC, role='role ' + SYNTHETIC)
        coordinator.runs[identifier]['engine'].thread.join(3)
        self.assertTrue(delivered)
        self.assertNotIn(SYNTHETIC, str(delivered))
        self.assertNotIn(SYNTHETIC, str(coordinator.state()))
        with self.store.connect() as db:
            self.assertNotIn(SYNTHETIC, str([tuple(r) for r in db.execute('SELECT * FROM agent_runs')]))
        coordinator.close()

    def test_discord_and_speech_last_mile_redaction(self):
        self.save()
        from glitch.discord_bot import DiscordGateway
        from glitch.speech_output import SpeechOutputService
        gateway = DiscordGateway(self.store, Mock())
        gateway._status(False, 'echo ' + SYNTHETIC)
        self.assertNotIn(SYNTHETIC, str(gateway.status()))
        with patch.object(SpeechOutputService, '_loop'):
            speech = SpeechOutputService(Mock(), self.store.settings, redactor=self.store.redact)
        try:
            speech.speak('echo ' + SYNTHETIC)
            self.assertNotIn(SYNTHETIC, speech.commands.get(timeout=1)[0])
        finally:
            speech.close()

    def test_json_escaped_exact_secret_is_redacted(self):
        secret = 'synthetic-"quoted"-\\fixture-ONLY'
        self.vault.save('Escaped fixture', 'bearer', ORIGIN, {'token': secret})
        encoded = json.dumps({'echo': secret})
        self.assertNotIn(json.dumps(secret)[1:-1], self.vault.redact(encoded))
        self.assertEqual(json.loads(self.vault.redact(encoded))['echo'], '[credential removed]')

    def test_existing_metadata_cannot_be_used_to_echo_a_new_secret(self):
        first = self.vault.save('Synthetic displayed fixture', 'bearer', ORIGIN, {'token': SYNTHETIC})
        with self.assertRaises(ValueError):
            self.vault.save('Second fixture', 'bearer', ORIGIN, {'token': first['name']})

    def test_custom_ca_validation_encrypts_pem_and_reports_metadata_only(self):
        import requests
        bundle = Path(requests.certs.where()).read_text(encoding='ascii')
        begin = bundle.index('-----BEGIN CERTIFICATE-----')
        end = bundle.index('-----END CERTIFICATE-----', begin) + len('-----END CERTIFICATE-----')
        ca = bundle[begin:end]
        payload = {'token': SYNTHETIC, 'ca_pem': ca}
        item = self.vault.save('CA fixture', 'bearer', ORIGIN, payload)
        self.assertEqual(item['tls'], {'verify': True, 'custom_ca': True})
        self.assertNotIn('BEGIN CERTIFICATE', json.dumps(item))
        self.assertEqual(self.vault.resolve(item['id'], ORIGIN), payload)
        for file in self.store.directory.glob('glitch.sqlite3*'):
            self.assertNotIn(b'BEGIN CERTIFICATE', file.read_bytes())

    def test_cipher_failure_can_be_replaced_or_deleted_via_bridge(self):
        item = self.save()
        with self.store.connect() as db:
            db.execute('UPDATE vault SET ciphertext=? WHERE id=?', (b'corrupt', item['id']))
        api = DesktopAPI(self.store, AgentEngine(self.store, Mock()), Mock())
        self.assertEqual(api.vault_list()[0]['id'], item['id'])
        result = api.vault_save('Recovery fixture', 'bearer', ORIGIN,
                                {'token': 'synthetic-recovery-ONLY'}, item['id'])
        self.assertEqual(result['id'], item['id'])
        with self.store.connect() as db:
            db.execute('UPDATE vault SET ciphertext=? WHERE id=?', (b'corrupt-again', item['id']))
        self.assertEqual(api.vault_delete(item['id']), {'ok': True})

    def test_native_send_does_not_optimistically_echo_secrets(self):
        self.save()
        engine = AgentEngine(self.store, Mock())
        api = DesktopAPI(self.store, engine, Mock())
        with patch.object(engine, 'start'):
            result = api.send('synthetic-session', 'echo ' + SYNTHETIC)
        self.assertEqual(result.get('prompt'), 'echo [credential removed]')

    def test_metadata_listing_redacts_legacy_setting_values(self):
        self.vault.save('Synthetic display label ONLY', 'bearer', ORIGIN, {'token': SYNTHETIC})
        with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': 'Synthetic display label ONLY'}):
            self.assertNotIn('Synthetic display label ONLY', str(self.vault.list()))

    def test_browser_dom_echo_never_enters_model_feedback(self):
        self.save()
        session = self.store.new_session(self.root)
        seen = []
        class Models:
            def chat(inner, settings, messages, cancel):
                seen.append(json.loads(json.dumps(messages)))
                if len(seen) == 1:
                    return {'done': False, 'message': 'Inspect', 'tool': {'name': 'browser_action', 'args': {'action': 'text'}}}
                return {'done': True, 'message': 'Verified', 'tool': None}
        engine = AgentEngine(self.store, Models())
        with patch('glitch.engine.ComputerTools.execute', return_value={'ok': True, 'value': SYNTHETIC}):
            engine.run_sync(session, 'Inspect a synthetic page')
        self.assertEqual(len(seen), 2)
        self.assertNotIn(SYNTHETIC, str(seen))
        self.assertNotIn(SYNTHETIC, str(self.store.events(session, 0)))

    def test_windows_no_plaintext_fallback_on_cipher_failure(self):
        def failed_cipher(*_args, **_kwargs):
            raise RuntimeError('synthetic encryption failure ' + SYNTHETIC)
        vault = Vault(self.store, cipher=failed_cipher)
        with self.assertRaises(RuntimeError) as error:
            vault.save('Failed fixture', 'bearer', ORIGIN, {'token': SYNTHETIC})
        self.assertNotIn(SYNTHETIC, str(error.exception))
        self.assertEqual(vault.list(), [])

    def test_unreadable_vault_recovery_uses_raw_coordinator_admission_state(self):
        item = self.save()
        with self.store.connect() as db:
            db.execute('UPDATE vault SET ciphertext=? WHERE id=?', (b'broken-fixture', item['id']))
        coordinator = AgentCoordinator(self.store, Mock())
        api = DesktopAPI(self.store, coordinator, Mock())
        self.assertEqual(api.vault_list()[0]['id'], item['id'])
        self.assertEqual(api.vault_delete(item['id']), {'ok': True})

    def test_task_redaction_shares_vault_mutation_admission_lock(self):
        class Models:
            def chat(inner, *_):
                return {'done': True, 'message': 'Fixture completed', 'tool': None}
        coordinator = AgentCoordinator(self.store, Models())
        session = self.store.new_session(self.root)
        acquired = []
        calling_thread = threading.current_thread()
        original = self.store.redact
        def probe(value):
            if threading.current_thread() is calling_thread and not acquired:
                def contender():
                    entered = coordinator.lock.acquire(blocking=False)
                    acquired.append(entered)
                    if entered:
                        coordinator.lock.release()
                worker = threading.Thread(target=contender)
                worker.start()
                worker.join(2)
            return original(value)
        with patch.object(self.store, 'redact', side_effect=probe):
            identifier = coordinator.start(session, 'Fixture task')
            coordinator.runs[identifier]['engine'].thread.join(3)
        coordinator.close()
        self.assertEqual(acquired, [False])


if __name__ == '__main__':
    unittest.main()
