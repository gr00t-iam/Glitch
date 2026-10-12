"""Completion and selected-supervisor regressions; model decisions are unit fakes."""
import hashlib
import tempfile
import socket
import threading
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from glitch.engine import AgentEngine
from glitch.storage import Store
from glitch.supervisor import SupervisorBridge
from glitch.tools import WorkspaceTools
from glitch.computer import ChromeController
from glitch.tests.test_runtime import FakeModels


def done(message='Created wiki.html.'):
    return {'done': True, 'message': message, 'tool': None}


def write(path='wiki.html'):
    return {'done': False, 'message': 'Preparing the file.', 'tool': {
        'name': 'write_file', 'args': {'path': path, 'content': '<h1>Fixture</h1>'}}}


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.store = Store(self.root / 'data')
        self.store.save_settings({'max_steps': 4, 'mode': 'local'})
        self.session = self.store.new_session(str(self.workspace))

    def tearDown(self):
        self.temp.cleanup()

    def run_worker(self, decisions, prompt='Create wiki.html in the selected workspace.', approve=True):
        worker = FakeModels(decisions)
        engine = AgentEngine(self.store, worker)
        with patch.object(engine, '_approve', return_value=approve):
            engine.run_sync(self.session, prompt)
        return worker, self.store.events(self.session, 0)

    def test_fabricated_done_never_published_and_retries_are_bounded(self):
        worker, events = self.run_worker([done()] * 4)
        self.assertFalse(any(e['kind'] in ('message', 'completed') for e in events))
        self.assertFalse(any(m['role'] == 'assistant' for m in self.store.messages(self.session)))
        self.assertLessEqual(len(worker.contexts), 4)
        self.assertIn('write_file', worker.contexts[1][-1]['content'])
        self.assertTrue(any(e['kind'] == 'paused' for e in events))

    def test_approved_write_has_actual_readback_exact_path_and_hash(self):
        _, events = self.run_worker([write(), done()])
        self.assertTrue(any(e['kind'] == 'completed' for e in events))
        proofs = [e['payload']['result'] for e in events if e['kind'] == 'result' and e['title'] == 'read_file']
        self.assertTrue(proofs)
        self.assertEqual(proofs[-1]['absolute_path'], str((self.workspace / 'wiki.html').resolve()))
        self.assertEqual(proofs[-1]['sha256'], hashlib.sha256((self.workspace / 'wiki.html').read_bytes()).hexdigest())
        self.assertIn(str((self.workspace / 'wiki.html').resolve()), self.store.messages(self.session)[-1]['content'])

    def test_denied_write_does_not_complete_or_bypass_approval(self):
        _, events = self.run_worker([write(), done(), done(), done()], approve=False)
        self.assertFalse((self.workspace / 'wiki.html').exists())
        self.assertFalse(any(e['kind'] == 'completed' for e in events))
        self.assertFalse(any(e['kind'] == 'message' and 'Created' in e['payload']['text'] for e in events))

    def test_wrong_file_is_not_requested_artifact(self):
        _, events = self.run_worker([write('other.html'), done(), done(), done()])
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_fake_write_success_without_physical_file_is_rejected(self):
        with patch.object(WorkspaceTools, 'write', return_value={'ok': True, 'path': 'wiki.html', 'bytes': 16}):
            _, events = self.run_worker([write(), done(), done(), done()])
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_preexisting_file_without_this_turn_write_is_not_proof(self):
        (self.workspace / 'wiki.html').write_text('old', encoding='utf-8')
        _, events = self.run_worker([done()] * 4)
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_changed_file_after_write_is_not_proof(self):
        original = WorkspaceTools.write
        def changed(tools, args):
            result = original(tools, args)
            (self.workspace / args['path']).write_text('intervening edit', encoding='utf-8')
            return result
        with patch.object(WorkspaceTools, 'write', changed):
            _, events = self.run_worker([write(), done(), done(), done()])
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_outside_write_remains_blocked(self):
        _, events = self.run_worker([write('../outside.html'), done(), done(), done()])
        self.assertFalse((self.root / 'outside.html').exists())
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_ordinary_chat_needs_no_artifact(self):
        _, events = self.run_worker([done('Hello.')], prompt='Hello')
        self.assertTrue(any(e['kind'] == 'completed' for e in events))

    def test_html_explanation_needs_no_artifact(self):
        _, events = self.run_worker([done('Use an h1 element.')], prompt='Explain how to create an HTML file.')
        self.assertTrue(any(e['kind'] == 'completed' for e in events))

    def test_explanation_can_describe_creation_without_claiming_execution(self):
        _, events = self.run_worker([done('An HTML file is created by saving text. For example wiki.html is created from markup.')],
                                    prompt='Explain how to create an HTML file.')
        self.assertTrue(any(e['kind'] == 'completed' for e in events))

    def test_generic_website_creation_is_gated(self):
        _, events = self.run_worker([done('Website created.')] * 4, prompt='Build a wiki website in my project folder.')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_unimplemented_binary_artifact_is_not_reported_created(self):
        _, events = self.run_worker([done('Created report.docx.')] * 4, prompt='Create report.docx.')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_final_claim_cannot_substitute_unwritten_file(self):
        _, events = self.run_worker([write(), done('Created absent.html.'), done('Created absent.html.'), done('Created absent.html.')])
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_unsolicited_artifact_claim_in_chat_is_not_published(self):
        _, events = self.run_worker([done()] * 4, prompt='Hello')
        self.assertFalse(any(e['kind'] in ('message', 'completed') for e in events))

    def test_cancel_after_model_response_withholds_completion(self):
        engine = AgentEngine(self.store, FakeModels([]))
        def cancelled(*_):
            engine.stop()
            return done('Hello')
        engine.models.chat = cancelled
        engine.run_sync(self.session, 'Hello')
        self.assertFalse(any(e['kind'] == 'completed' for e in self.store.events(self.session, 0)))

    def test_quoted_output_path_with_spaces_can_complete(self):
        _, events = self.run_worker([write('notes/wiki page.html'), done('Created the requested file.')],
                                    prompt='Create "notes/wiki page.html".')
        self.assertTrue(any(e['kind'] == 'completed' for e in events))

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows path identity')
    def test_windows_filename_case_does_not_reject_same_file(self):
        _, events = self.run_worker([write('Wiki.html'), done('Created wiki.html.')])
        self.assertTrue(any(e['kind'] == 'completed' for e in events))

    def test_hybrid_missing_completion_injects_persisted_correction(self):
        self.store.save_settings({'mode': 'hybrid'})
        worker, _ = self.run_worker([done(), write(), done()])
        self.assertTrue(worker.reviews)
        self.assertIn(self.store.anchors(self.session)[0], worker.contexts[1][0]['content'])

    def test_verified_historical_reference_needs_no_new_tool_or_rewrite(self):
        self.run_worker([write(), done()])
        path = self.workspace / 'wiki.html'
        original = path.read_bytes(), path.stat().st_mtime_ns
        cursor = self.store.events(self.session, 0)[-1]['id']
        self.store = Store(self.root / 'data')
        worker, _ = self.run_worker([done('We created wiki.html yesterday.')] * 4,
                                    prompt='What did we create yesterday?')
        events = self.store.events(self.session, cursor)
        self.assertTrue(any(e['kind'] == 'completed' for e in events))
        self.assertEqual(len(worker.contexts), 1)
        self.assertFalse(any(e['kind'] in ('tool', 'result', 'approval') for e in events))
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), original)
        self.assertEqual(self.store.messages(self.session)[-1]['content'], 'We created wiki.html yesterday.')

    def test_unverified_nonexistent_historical_claim_is_not_blessed(self):
        self.store.message(self.session, 'assistant', 'We created wiki.html yesterday.')
        _, events = self.run_worker([done('We created wiki.html yesterday.')] * 4,
                                    prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))
        self.assertFalse((self.workspace / 'wiki.html').exists())

    def test_existing_file_and_old_assistant_claim_are_not_historical_proof(self):
        (self.workspace / 'wiki.html').write_text('unverified', encoding='utf-8')
        self.store.message(self.session, 'assistant', 'We created wiki.html yesterday.')
        _, events = self.run_worker([done('We created wiki.html yesterday.')] * 4,
                                    prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_prior_verified_write_does_not_bless_current_fake_claim(self):
        self.run_worker([write(), done()])
        cursor = self.store.events(self.session, 0)[-1]['id']
        self.run_worker([done()] * 4)
        self.assertFalse(any(e['kind'] == 'completed' for e in self.store.events(self.session, cursor)))

    def test_historical_reference_requires_evidence_for_each_named_file(self):
        self.run_worker([write(), done()])
        cursor = self.store.events(self.session, 0)[-1]['id']
        self.run_worker([done('We created absent.html yesterday.')] * 4,
                        prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in self.store.events(self.session, cursor)))

    def test_other_conversation_write_is_not_historical_proof(self):
        self.run_worker([write(), done()])
        self.session = self.store.new_session(str(self.workspace))
        _, events = self.run_worker([done('We created wiki.html yesterday.')] * 4,
                                    prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_historical_question_does_not_bless_new_execution_claim(self):
        self.run_worker([write(), done()])
        cursor = self.store.events(self.session, 0)[-1]['id']
        self.run_worker([done('We created wiki.html now.')] * 4,
                        prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in self.store.events(self.session, cursor)))

    def test_current_write_cannot_substantiate_unverified_past_creation(self):
        _, events = self.run_worker([write(), done('We created wiki.html yesterday.'),
                                    done('We created wiki.html yesterday.'), done('We created wiki.html yesterday.')],
                                    prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in events))

    def test_unfinished_prior_write_is_not_historical_proof(self):
        self.store.save_settings({'max_steps': 1})
        self.run_worker([write()])
        cursor = self.store.events(self.session, 0)[-1]['id']
        self.store.save_settings({'max_steps': 4})
        self.run_worker([done('We created wiki.html yesterday.')] * 4,
                        prompt='What did we create yesterday?')
        self.assertFalse(any(e['kind'] == 'completed' for e in self.store.events(self.session, cursor)))

    def test_historical_proof_can_follow_first_event_page(self):
        for step in range(305):
            self.store.event(self.session, 'local', 'Synthetic earlier step', {'step': step})
        self.run_worker([write(), done()])
        worker, _ = self.run_worker([done('We created wiki.html yesterday.')],
                                    prompt='What did we create yesterday?')
        self.assertEqual(len(worker.contexts), 1)
        self.assertEqual(self.store.messages(self.session)[-1]['content'], 'We created wiki.html yesterday.')

    def test_utf8_crossing_preview_byte_boundary_can_complete(self):
        content = 'a' * 119999 + chr(0xe9) + 'tail'
        decision = write()
        decision['tool']['args']['content'] = content
        _, events = self.run_worker([decision, done(), done(), done()])
        self.assertTrue(any(e['kind'] == 'completed' for e in events))
        proof = next(e['payload']['result'] for e in events
                     if e['kind'] == 'result' and e['title'] == 'read_file')
        self.assertEqual(proof['bytes'], 120005)
        self.assertEqual(proof['sha256'], hashlib.sha256(content.encode('utf-8')).hexdigest())
        self.assertEqual(proof['content'], content[:120000])
        self.assertTrue(proof['truncated'])
        self.assertEqual((self.workspace / 'wiki.html').read_bytes(), content.encode('utf-8'))


class SupervisorReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name))
        self.settings = self.store.save_settings({'supervisor_auth': 'proxy',
            'proxy_url': 'http://127.0.0.1:10531/v1', 'proxy_model': 'gpt-6.1-sol'})
        self.bridge = SupervisorBridge(self.store)

    def tearDown(self):
        self.temp.cleanup()

    def response(self, data, status=200):
        response = MagicMock()
        response.__enter__.return_value = response
        response.ok = status == 200
        response.status_code = status
        response.json.return_value = data
        return response

    def test_proxy_review_omits_temperature_keeps_selected_model(self):
        with patch('glitch.supervisor.requests.post', return_value=self.response(
                {'choices': [{'message': {'content': 'Read the actual file.'}}]})) as post:
            self.bridge.review(self.settings, 'synthetic', [], 'tool error', threading.Event())
        body = post.call_args.kwargs['json']
        self.assertNotIn('temperature', body)
        self.assertEqual(body['model'], 'gpt-6.1-sol')
        self.assertEqual(body['max_tokens'], 600)

    def test_connection_proves_selected_model_generation(self):
        with patch('glitch.supervisor.requests.get', return_value=self.response({'data': [{'id': 'other'}]})), \
             patch('glitch.supervisor.requests.post', return_value=self.response(
                 {'choices': [{'message': {'content': 'GLITCH_CONNECTION_OK'}}]})) as post:
            result = self.bridge.test(self.settings)
        self.assertTrue(result['ok'])
        self.assertTrue(result['catalog_ok'])
        self.assertTrue(result['generation_ok'])
        self.assertEqual(post.call_args.kwargs['json']['model'], 'gpt-6.1-sol')
        self.assertIn('gpt-6.1-sol', result['message'])

    def test_catalog_success_generation_failure_is_not_connected(self):
        with patch('glitch.supervisor.requests.get', return_value=self.response({'data': []})), \
             patch('glitch.supervisor.requests.post', return_value=self.response({}, 500)):
            result = self.bridge.test(self.settings)
        self.assertFalse(result['ok'])
        self.assertTrue(result['catalog_ok'])
        self.assertFalse(result['generation_ok'])
        self.assertIn('500', result['message'])

    def test_generation_empty_is_failure(self):
        with patch('glitch.supervisor.requests.get', return_value=self.response({'data': []})), \
             patch('glitch.supervisor.requests.post', return_value=self.response(
                 {'choices': [{'message': {'content': ''}}]})):
            self.assertFalse(self.bridge.test(self.settings)['ok'])

    def test_cancelled_review_sends_nothing(self):
        cancel = threading.Event()
        cancel.set()
        with patch('glitch.supervisor.requests.post') as post, self.assertRaises(InterruptedError):
            self.bridge.review(self.settings, '', [], '', cancel)
        post.assert_not_called()

    def test_openai_reasoning_omits_temperature(self):
        settings = self.settings | {'supervisor_auth': 'api', 'supervisor_provider': 'openai',
                                    'supervisor_model': 'gpt-6.1-sol'}
        with patch.object(self.store, 'supervisor_key', return_value='synthetic'), \
             patch('glitch.supervisor.requests.post', return_value=self.response(
                 {'choices': [{'message': {'content': 'Continue.'}}]})) as post:
            self.bridge.review(settings, '', [], '', threading.Event())
        self.assertNotIn('temperature', post.call_args.kwargs['json'])

    def test_anthropic_keeps_native_route_and_temperature(self):
        settings = self.settings | {'supervisor_auth': 'api', 'supervisor_provider': 'anthropic',
                                    'supervisor_model': 'fixture'}
        with patch.object(self.store, 'supervisor_key', return_value='synthetic'), \
             patch('glitch.supervisor.requests.post', return_value=self.response(
                 {'content': [{'type': 'text', 'text': 'Continue.'}]})) as post:
            self.bridge.review(settings, '', [], '', threading.Event())
        self.assertTrue(post.call_args.args[0].endswith('/messages'))
        self.assertEqual(post.call_args.kwargs['json']['temperature'], 0.1)
        self.assertEqual(post.call_args.kwargs['headers']['x-api-key'], 'synthetic')


class ChromeOwnershipTests(unittest.TestCase):
    def test_foreign_non_http_listener_is_refused_before_launch(self):
        with tempfile.TemporaryDirectory() as folder, socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            chrome = ChromeController(folder)
            chrome.base = f'http://127.0.0.1:{listener.getsockname()[1]}'
            with patch('psutil.process_iter', return_value=[]), \
                 patch('glitch.computer.subprocess.Popen') as launch, \
                 self.assertRaisesRegex(ValueError, 'occupied|belongs'):
                chrome.ensure()
            launch.assert_not_called()
