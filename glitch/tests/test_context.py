"""Local compaction contracts, using an exact deterministic test tokenizer."""
import copy
import importlib.util
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from glitch.storage import Store, DEFAULTS
from glitch.redaction import ProtocolText, action

if importlib.util.find_spec('glitch.context'):
    from glitch.context import ContextManager, ContextError, SUMMARY_SCHEMA
else:
    ContextManager = None
    ContextError = RuntimeError
    SUMMARY_SCHEMA = {}


class ExactModels:
    """Every character is one fixture token, including roles/template delimiters."""
    def __init__(self):
        self.counts, self.summaries = [], []
        self.candidate = None

    def count_prompt(self, settings, messages, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped')
        self.counts.append(copy.deepcopy(messages))
        return sum(len(m['content']) + len(m['role']) + 4 for m in messages)

    def summarize(self, settings, messages, schema, cancel):
        self.summaries.append(copy.deepcopy(messages))
        if isinstance(self.candidate, Exception):
            raise self.candidate
        if self.candidate is not None:
            return copy.deepcopy(self.candidate)
        # A valid empty extractive summary: mandatory critical facts are host-owned.
        return {'facts': []}


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(ContextManager, 'Task 4 ContextManager is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'data')
        self.session = self.store.new_session(self.root)
        self.models = ExactModels()
        self.manager = ContextManager(self.store, self.models)
        self.settings = DEFAULTS | {'context_length': 12000, 'mode': 'local', 'parallel_streams': 4}
        self.system = {'role': 'system', 'content': 'Safety rules and complete tool schemas.'}
        self.cancel = threading.Event()
        self.events = []

    def add(self, role, text, **kwargs):
        return self.store.message(self.session, role, text, **kwargs)

    def prepare(self, messages=None):
        return self.manager.prepare(self.session, self.system, messages, self.settings,
                                    self.cancel, lambda *args: self.events.append(args))

    def history(self):
        self.add('user', 'Build only notes.txt; no cloud or publishing. Destination: project folder.')
        for _ in range(8):
            self.add('assistant', 'Older unverified commentary. ' * 70)
        self.add('user', 'Continue and preserve all safety approvals.')

    def test_below_threshold_keeps_verbatim_history_and_counts_system(self):
        self.add('user', 'Hello')
        messages = self.store.messages(self.session)
        self.assertEqual(self.prepare(messages), [self.system] + messages)
        self.assertFalse(self.models.summaries)
        self.assertIsNone(self.store.context_checkpoint(self.session))
        self.assertEqual(self.models.counts[-1][0], self.system)

    def test_threshold_compacts_local_preserves_constraints_recent_and_archive(self):
        self.history()
        originals = self.store.messages(self.session)
        result = self.prepare(originals)
        checkpoint = self.store.context_checkpoint(self.session)
        self.assertIsNotNone(checkpoint)
        text = '\n'.join(m['content'] for m in result)
        self.assertIn(originals[0]['content'], text)
        self.assertEqual(result[-1], originals[-1])
        self.assertEqual(self.store.messages(self.session), originals)
        self.assertTrue(set(checkpoint['source_ids']).issubset({m['id'] for m in originals}))
        self.assertLessEqual(self.models.count_prompt(self.settings, result, self.cancel) + 1568, 12000)
        self.assertEqual(self.events[-1][0:2], ('context_refreshed', 'Context refreshed'))
        self.assertTrue(self.models.summaries)

    def test_75_percent_is_of_prompt_allowance_not_stream_multiplied_pool(self):
        allowance = 12000 - 1568
        overhead = self.models.count_prompt(self.settings, [self.system, {'role': 'assistant', 'content': ''},
                                                                      {'role': 'user', 'content': 'recent'}], self.cancel)
        self.add('assistant', 'x' * (int(allowance * .75) - overhead))
        self.add('user', 'recent')
        self.prepare()
        self.assertIsNotNone(self.store.context_checkpoint(self.session))

    def test_malformed_candidate_never_commits(self):
        self.history()
        for candidate in ({}, {'facts': 'wrong'}, {'facts': [], 'invented': True},
                          {'facts': [{'kind': 'decisions', 'source_id': True, 'quote': 'made up'}]}):
            with self.subTest(candidate=candidate):
                self.models.candidate = candidate
                with self.assertRaises(ContextError):
                    self.prepare()
                self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_invented_quote_and_wrong_session_source_rejected(self):
        self.history()
        foreign = self.store.new_session(self.root)
        identifier = self.store.message(foreign, 'user', 'foreign quote')
        for source, quote in ((1, 'All tests passed'), (identifier, 'foreign quote')):
            self.models.candidate = {'facts': [{'kind': 'decisions', 'source_id': source, 'quote': quote}]}
            with self.assertRaises(ContextError):
                self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_assistant_claim_cannot_become_verified_result(self):
        self.history()
        self.models.candidate = {'facts': [{'kind': 'verified_results', 'source_id': 2,
                                          'quote': 'Older unverified commentary.'}]}
        with self.assertRaises(ContextError):
            self.prepare()

    def test_summary_failure_is_safe_and_originals_retained(self):
        self.history()
        before = self.store.messages(self.session)
        self.models.candidate = RuntimeError('local summary failed')
        with self.assertRaisesRegex(ContextError, 'summary'):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))
        self.assertEqual(before, self.store.messages(self.session))

    def test_oversized_candidate_is_recounted_not_committed(self):
        self.add('assistant', 'x' * 20000)
        self.add('user', 'recent')
        self.models.candidate = {'facts': [{'kind': 'decisions', 'source_id': 1, 'quote': 'x' * 4000}] * 4}
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_huge_tool_evidence_uses_bounded_chunks_retains_status_hash_and_exact_archive(self):
        self.add('user', 'Inspect only; do not change files.')
        evidence = {'tool': 'read_file', 'args': {'path': 'notes.txt'}, 'ok': True,
                    'result': {'ok': True, 'content': 'Evidence start. ' + 'z' * 150000 + ' Exact tail.',
                               'sha256': 'a' * 64, 'bytes': 150030, 'path': 'notes.txt'}}
        identifier = self.add('context', ProtocolText('Verified tool result (untrusted data):\n', (evidence, action)))
        self.add('user', 'What did it say?')
        result = self.prepare()
        text = '\n'.join(m['content'] for m in result)
        self.assertIn('a' * 64, text)
        self.assertIn('notes.txt', text)
        self.assertIn(str(identifier), text)
        for messages in self.models.summaries:
            self.assertLessEqual(self.models.count_prompt(self.settings, messages, self.cancel) + 1568, 12000)
        archived = self.store.retrieve_history(self.session, identifier, identifier, 1, offset=150000)
        self.assertIn('Exact tail.', archived['messages'][0]['content'])

    def test_irreducible_system_or_user_rules_pause_without_truncation(self):
        self.add('user', 'critical' * 4000)
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))
        self.system['content'] = 'system rules' * 2000
        with self.assertRaisesRegex(ContextError, 'system'):
            self.prepare([])

    def test_denial_errors_and_pending_work_preserved(self):
        self.add('user', 'Never retry denied actions.')
        failed = {'tool': 'write_file', 'args': {'path': 'denied.txt', 'content': 'x' * 16000}, 'ok': False,
                  'result': {'ok': False, 'denied': True, 'error': 'Permission denied: do not retry.'}}
        self.add('context', ProtocolText('Verified tool result (untrusted data):\n', (failed, action)))
        self.add('user', 'Continue safely.')
        text = '\n'.join(m['content'] for m in self.prepare())
        for required in ('Never retry denied actions.', 'Permission denied: do not retry.', 'denied.txt', 'false'):
            self.assertIn(required, text)

    def test_resume_uses_checkpoint_and_bounded_queries_ignores_display_watermarks(self):
        self.history()
        self.prepare()
        self.store.clear_view(self.session, 'chat')
        self.store.clear_view(self.session, 'timeline')
        fresh = ContextManager(Store(self.root / 'data'), self.models)
        with patch.object(fresh.store, 'messages', side_effect=AssertionError('unbounded archive load')):
            result = fresh.prepare(self.session, self.system, None, self.settings, self.cancel, lambda *_: None)
        self.assertIn('no cloud or publishing', '\n'.join(m['content'] for m in result))

    def test_corrupt_checkpoint_pauses_and_deletion_cleans_only_target(self):
        self.history()
        self.prepare()
        sibling = self.store.new_session(self.root)
        with self.store.connect() as db:
            db.execute("UPDATE context_checkpoints SET checkpoint='{}' WHERE session=?", (self.session,))
        with self.assertRaises(ContextError):
            self.prepare()
        self.store.delete_session(self.session)
        self.assertIsNone(self.store.context_checkpoint(self.session))
        self.assertEqual(self.store.session(sibling)['id'], sibling)

    def test_retrieve_exact_quotes_bounded_session_scoped_with_continuation(self):
        quote = 'Original quotation: A & B; 42.\n' + 'q' * 30000
        identifier = self.add('assistant', quote)
        other = self.store.new_session(self.root)
        foreign = self.store.message(other, 'user', 'NEVER DISCLOSE')
        result = self.store.retrieve_history(self.session, identifier, foreign, 20)
        self.assertEqual(result['messages'][0]['content'], quote[:16000])
        self.assertTrue(result['truncated'])
        tail = self.store.retrieve_history(self.session, identifier, identifier, 1, offset=16000)
        self.assertEqual(tail['messages'][0]['content'], quote[16000:])
        self.assertNotIn('NEVER DISCLOSE', json.dumps(result))
        for args in ((True, foreign, 1), (identifier, foreign, 21), (foreign, identifier, 1)):
            with self.assertRaises(ValueError):
                self.store.retrieve_history(self.session, *args)

    def test_anchors_bounded_active_with_archive_references_and_originals(self):
        for i in range(20):
            self.store.anchor(self.session, f'Correction {i}: keep approvals.')
        original = self.store.anchors(self.session)
        self.add('user', 'Hello')
        result = self.prepare()
        text = result[0]['content']
        self.assertIn('Correction 19', text)
        self.assertIn('archived_anchor', text)
        self.assertNotIn('Correction 0:', text)
        self.assertEqual(self.store.anchors(self.session), original)

    def test_recent_screenshot_preserved_and_not_fabricated_in_summary(self):
        self.history()
        self.add('context', 'Approved screenshot; visual contents not established.', images=['YWJj'])
        result = self.prepare()
        self.assertEqual(result[-1]['images'], ['YWJj'])
        self.assertFalse(any(m.get('images') for request in self.models.summaries for m in request))

    def test_cancel_before_and_during_summary_never_commits(self):
        self.history()
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            self.prepare()
        self.cancel.clear()
        def stop(*_):
            self.cancel.set()
            return {'facts': []}
        self.models.summarize = stop
        with self.assertRaises(InterruptedError):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_atomic_checkpoint_rejects_source_changed_after_summary(self):
        self.history()
        original = self.models.summarize
        def change(*args):
            with self.store.connect() as db:
                db.execute("UPDATE messages SET content='changed' WHERE id=1")
            return original(*args)
        self.models.summarize = change
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_decision_reports_keep_paths_and_intent_without_blessing_completion(self):
        from glitch.redaction import DECISION
        self.add('user', 'Only modify the approved destination notes/report.txt.')
        decision = {'done': False, 'message': 'Pending approved change, then read back.', 'tool':
                    {'name': 'write_file', 'args': {'path': 'notes/report.txt', 'content': 'x' * 15000}}}
        self.add('assistant', decision['message'], model_content=ProtocolText((decision, DECISION)))
        self.add('user', 'Continue with the approved scope.')
        text = '\n'.join(m['content'] for m in self.prepare())
        checkpoint = self.store.context_checkpoint(self.session)
        self.assertTrue(checkpoint['decision_reports'])
        self.assertIn('Pending approved change, then read back.', text)
        self.assertIn('notes/report.txt', text)
        self.assertIn('"done": false', text)

    def test_archive_tool_can_read_exact_full_working_envelope(self):
        from glitch.redaction import DECISION
        decision = {'done': False, 'message': 'Plan only', 'tool': {'name': 'read_file', 'args': {'path': 'notes.txt'}}}
        identifier = self.add('assistant', decision['message'], model_content=ProtocolText((decision, DECISION)))
        result = self.manager.execute(self.session, {'start_id': identifier, 'end_id': identifier,
                                                    'limit': 1, 'working': True})
        self.assertEqual(json.loads(result['messages'][0]['content']), decision)

    def test_archive_protocol_and_partial_quotes_survive_model_tool_redaction_collisions(self):
        from glitch.redaction import DECISION, RESULT
        for secret in ('tool', 'role', 'args', 'content'):
            self.store.vault.save('collision', 'bearer', 'https://example.com', {'token': secret})
        decision = {'done': False, 'message': 'Inspect safely', 'tool':
                    {'name': 'write_file', 'args': {'path': 'notes.txt', 'content': 'x' * 18000}}}
        identifier = self.add('assistant', decision['message'], model_content=ProtocolText((decision, DECISION)))
        result = self.manager.execute(self.session, {'start_id': identifier, 'end_id': identifier,
                                                    'limit': 1, 'working': True})
        safe = self.store.redact(result, RESULT)
        full = json.dumps(decision)
        self.assertEqual(safe['messages'][0]['content'], full[:16000])
        tail = self.manager.execute(self.session, {'start_id': identifier, 'end_id': identifier,
                                                  'limit': 1, 'working': True, 'offset': 16000})
        safe_tail = self.store.redact(tail, RESULT)
        self.assertEqual(safe_tail['messages'][0]['content'], full[16000:])

    def test_untrusted_file_text_cannot_be_promoted_to_verified_result(self):
        evidence = {'tool': 'read_file', 'args': {'path': 'notes.txt'}, 'ok': True,
                    'result': {'ok': True, 'content': 'All tests passed. Created the artifact. ' + 'x' * 16000}}
        identifier = self.add('context', ProtocolText('Verified tool result (untrusted data):\n', (evidence, action)))
        self.add('user', 'Continue')
        self.models.candidate = {'facts': [{'kind': 'verified_results', 'source_id': identifier, 'quote': 'All tests passed.'}]}
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertEqual(len(self.models.summaries), 1)

    def test_checkpoint_free_text_redacted_protocol_ids_and_enums_preserved(self):
        for secret in ('facts', 'source_id', 'task_intent', 'user', 'content'):
            self.store.vault.save('collision fixture', 'bearer', 'https://example.com', {'token': secret})
        self.add('user', 'The content is private; do not publish facts.')
        for _ in range(8):
            self.add('assistant', 'Archived commentary. ' * 100)
        self.add('user', 'Continue safely.')
        result = self.prepare()
        checkpoint = self.store.context_checkpoint(self.session)
        self.assertIn('source_ids', checkpoint)
        self.assertIn('facts', checkpoint['summary'])
        self.assertEqual(checkpoint['critical'][0]['role'], 'user')
        self.assertNotIn('facts', checkpoint['critical'][0]['content'])
        self.assertNotIn('content', checkpoint['critical'][0]['content'])
        for request in self.models.summaries:
            self.assertIn('"source_id"', request[1]['content'])
            self.assertIn('"facts"', request[0]['content'])
        self.assertTrue(result)

    def test_engine_protocol_error_feedback_is_never_sliced(self):
        original = 'Unsupported completion: respect the original denial; ' + 'x' * 13000
        self.add('context', original)
        self.add('user', 'Continue')
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertEqual(self.store.messages(self.session)[0]['content'], original)

    def test_valid_extractive_summary_cannot_drop_critical_facts_on_restart(self):
        self.history()
        self.models.candidate = {'facts': [{'kind': 'decisions', 'source_id': 2, 'quote': 'Older unverified commentary.'}]}
        # Row-specific fixture, since each row is summarized separately.
        def summary(settings, messages, schema, cancel):
            segment = json.loads(messages[1]['content'])
            return {'facts': [{'kind': 'decisions', 'source_id': segment['source_id'],
                               'quote': segment['content'][:20]}]}
        self.models.summarize = summary
        self.prepare()
        checkpoint = self.store.context_checkpoint(self.session)
        checkpoint['critical'] = []
        with self.store.connect() as db:
            db.execute('UPDATE context_checkpoints SET checkpoint=? WHERE session=?', (json.dumps(checkpoint), self.session))
        with self.assertRaisesRegex(ContextError, 'critical'):
            self.prepare()

    def test_reference_limits_do_not_reset_per_source_or_recurse(self):
        self.history()
        with patch('glitch.context.MAX_CHUNKS', 2):
            with self.assertRaisesRegex(ContextError, 'chunk limit'):
                self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))

    def test_supplied_full_archive_after_checkpoint_does_not_skip_newer_page(self):
        self.add('user', 'Keep critical constraints.')
        for _ in range(40):
            self.add('assistant', 'old content ' * 100)
        self.add('user', 'First recent prompt')
        self.prepare()
        self.add('user', 'Newest prompt beyond first archive page')
        result = self.prepare(self.store.messages(self.session))
        self.assertEqual(result[-1]['content'], 'Newest prompt beyond first archive page')

    def test_multimodal_result_too_large_keeps_image_recent_or_pauses_not_silently_discards(self):
        identifier = self.add('context', 'Visual context text ' * 3000, images=['YWJj'])
        self.assertIsInstance(identifier, int)
        with self.assertRaises(ContextError):
            self.prepare()
        self.assertIsNone(self.store.context_checkpoint(self.session))


class CountAndSummaryTests(unittest.TestCase):
    def test_count_loads_model_before_using_actual_worker_tokenizer(self):
        from glitch.models import ModelClient
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            calls = []
            class Worker:
                loaded = False
                def status(self):
                    return {'name': 'fixture' if self.loaded else '', 'phase': 'ready' if self.loaded else 'unloaded'}
                def load(self, *args):
                    calls.append('load')
                    self.loaded = True
                def count_prompt(self, messages, cancel):
                    if not self.loaded:
                        raise AssertionError('Tokenizer used before loading')
                    calls.append('tokenizer')
                    return 5
            models = ModelClient(store, Worker())
            with patch.object(models.library, 'path', return_value=Path(root, 'fixture.gguf')):
                self.assertEqual(models.count_prompt(DEFAULTS | {'worker_model': 'fixture'},
                                    [{'role': 'user', 'content': 'Hello'}], threading.Event()), 5)
            self.assertEqual(calls, ['load', 'tokenizer'])

    def test_runtime_counts_actual_template_and_tokenizer_without_reservation(self):
        from glitch.shared_runtime import SharedModelRuntime, ContextBudget
        runtime = SharedModelRuntime()
        runtime.process = MagicMock()
        runtime.process.poll.return_value = None
        runtime.budget = ContextBudget(65535)
        client = MagicMock()
        formatted, counted = MagicMock(), MagicMock()
        formatted.json.return_value = {'prompt': 'exact template'}
        counted.json.return_value = {'tokens': [8, 4, 2, 1]}
        client.post.side_effect = [formatted, counted]
        for response in (formatted, counted):
            response.__enter__.return_value = response
        client.__enter__.return_value = client
        with patch.object(runtime, '_client', return_value=client):
            self.assertTrue(hasattr(runtime, 'count_prompt'), 'Runtime count_prompt is missing')
            self.assertEqual(runtime.count_prompt([{'role': 'system', 'content': 'schemas + anchors'}], threading.Event()), 4)
        self.assertEqual(client.post.call_args_list[1].kwargs['json'],
                         {'content': 'exact template', 'add_special': True, 'parse_special': True})
        self.assertEqual(runtime.budget.used, 0)
        self.assertEqual(runtime.active, 0)

    def test_model_summary_only_local_worker_and_schema_redaction(self):
        from glitch.models import ModelClient
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            worker = MagicMock()
            worker.status.return_value = {'name': 'fixture', 'phase': 'ready'}
            worker.chat.return_value = {'facts': []}
            worker.count_prompt.return_value = 17
            models = ModelClient(store, worker)
            self.assertTrue(hasattr(models, 'summarize'), 'Local summarize is missing')
            settings = DEFAULTS | {'worker_model': 'fixture', 'mode': 'local'}
            with patch.object(models.supervisor, 'review', side_effect=AssertionError('cloud forbidden')):
                self.assertEqual(models.summarize(settings, [{'role': 'user', 'content': 'safe'}],
                                                  SUMMARY_SCHEMA, threading.Event()), {'facts': []})
                self.assertEqual(models.count_prompt(settings, [{'role': 'user', 'content': 'safe'}], threading.Event()), 17)
            self.assertEqual(worker.chat.call_args.args[1], SUMMARY_SCHEMA)

    def test_summary_waits_for_ready_and_redacts_structural_collision_safely(self):
        from glitch.models import ModelClient
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            store.vault.save('collision', 'bearer', 'https://example.com', {'token': 'facts'})
            worker = MagicMock()
            worker.status.return_value = {'name': 'fixture', 'phase': 'ready'}
            worker.chat.return_value = {'facts': [{'kind': 'decisions', 'source_id': 1, 'quote': 'facts'}]}
            models = ModelClient(store, worker)
            settings = DEFAULTS | {'worker_model': 'fixture'}
            response = models.summarize(settings, [{'role': 'user', 'content': 'facts'}], SUMMARY_SCHEMA, threading.Event())
            self.assertIn('facts', response)
            self.assertNotIn('facts', response['facts'][0]['quote'])
            self.assertNotIn('facts', worker.chat.call_args.args[0][0]['content'])


class EngineContextTests(unittest.TestCase):
    def test_every_generation_and_resume_prepare_and_keep_feedback_roles(self):
        from glitch.engine import AgentEngine
        from glitch.tests.test_runtime import FakeModels
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'data')
            session = store.new_session(root)
            models = FakeModels([
                {'done': False, 'message': 'Reading.', 'tool': {'name': 'list_workspace', 'args': {'directory': '.'}}},
                {'done': True, 'message': 'Inspected.', 'tool': None},
                {'done': True, 'message': 'Hello.', 'tool': None}])
            from glitch.context import ContextManager
            original = ContextManager.prepare
            calls = []
            def track(manager, *args):
                calls.append(args[0])
                return original(manager, *args)
            with patch.object(ContextManager, 'prepare', track):
                AgentEngine(store, models).run_sync(session, 'Inspect directory')
                AgentEngine(Store(store.directory), models).run_sync(session, 'Hello again')
            self.assertEqual(len(calls), 3)
            self.assertEqual(len(models.contexts), 3)
            self.assertEqual(models.contexts[1][-1]['role'], 'user')
            self.assertIn('Verified tool result', models.contexts[1][-1]['content'])
            self.assertTrue(any('"tool"' in m['content'] and 'Reading.' in m['content'] for m in models.contexts[2]))
            self.assertIn('retrieve_history', models.contexts[0][0]['content'])

    def test_explicit_archive_tool_session_fixed_and_exact(self):
        from glitch.engine import AgentEngine
        from glitch.tests.test_runtime import FakeModels
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'data')
            session = store.new_session(root)
            identifier = store.message(session, 'user', 'Exact original quotation: Keep approvals.')
            models = FakeModels([
                {'done': False, 'message': '', 'tool': {'name': 'retrieve_history', 'args':
                    {'start_id': identifier, 'end_id': identifier, 'limit': 1}}},
                {'done': True, 'message': 'Retrieved.', 'tool': None}])
            AgentEngine(store, models).run_sync(session, 'Read the exact older quotation')
            self.assertIn('Exact original quotation: Keep approvals.', models.contexts[-1][-1]['content'])
            self.assertTrue(any(e['kind'] == 'completed' for e in store.events(session, 0)))

    def test_context_error_pauses_without_model_call_or_completion(self):
        from glitch.engine import AgentEngine
        from glitch.tests.test_runtime import FakeModels
        from glitch.context import ContextManager
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'data')
            session = store.new_session(root)
            models = FakeModels([{'done': True, 'message': 'Hello', 'tool': None}])
            with patch.object(ContextManager, 'prepare', side_effect=ContextError('Unsafe checkpoint')):
                AgentEngine(store, models).run_sync(session, 'Hello')
            self.assertFalse(models.contexts)
            self.assertTrue(any(e['kind'] == 'paused' for e in store.events(session, 0)))
            self.assertFalse(any(e['kind'] == 'completed' for e in store.events(session, 0)))

    def test_live_ui_handles_refresh_status(self):
        js = (Path(__file__).parents[1] / 'ui' / 'app.js').read_text(encoding='utf-8')
        self.assertIn("'context_refreshed'", js)
        self.assertIn("'context_refreshed'].includes(event.kind)) status(event.title, event.kind)", js)

    def test_refresh_event_numeric_count_survives_persistence_and_ui_poll_boundary(self):
        from glitch.api import DesktopAPI
        from glitch.engine import AgentEngine
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root) / 'data')
            session = store.new_session(root)
            models = ExactModels()
            engine = AgentEngine(store, models)
            engine.running_session = session
            store.message(session, 'user', 'Do not publish or bypass approvals.')
            for _ in range(8):
                store.message(session, 'assistant', 'older commentary ' * 100)
            store.message(session, 'user', 'Continue')
            ContextManager(store, models).prepare(session, {'role': 'system', 'content': 'Rules'}, None,
                    DEFAULTS | {'context_length': 12000}, threading.Event(), engine._emit)
            event = next(e for e in store.events(session, 0) if e['kind'] == 'context_refreshed')
            self.assertIsInstance(event['payload'].get('prompt_count'), int)
            self.assertEqual(event['title'], 'Context refreshed')
            checkpoint = store.context_checkpoint(session)
            self.assertEqual(type(checkpoint['token_count']), int)
            self.assertEqual(event['payload']['prompt_count'], checkpoint['token_count'])
            # Real event serialization/redaction on the path consumed by addEvent.
            api = DesktopAPI(store, engine, models)
            polled = next(e for e in api.poll(session, 0)['events'] if e['kind'] == 'context_refreshed')
            self.assertEqual(polled['payload']['prompt_count'], checkpoint['token_count'])
            self.assertEqual(polled['kind'], 'context_refreshed')
            self.assertEqual(polled['title'], 'Context refreshed')


class EvidencePreviewTests(unittest.TestCase):
    def test_large_read_preview_does_not_split_utf8_character(self):
        from glitch.tools import WorkspaceTools
        with tempfile.TemporaryDirectory() as root:
            text = 'a' * 119999 + '\u20ac' + 'Exact tail.'
            Path(root, 'large.txt').write_text(text, encoding='utf-8')
            tools = WorkspaceTools(root, lambda *_: True, lambda *_: None, threading.Event())
            result = tools.execute('read_file', {'path': 'large.txt'})
            self.assertEqual(result['content'], 'a' * 119999)
            self.assertTrue(result['truncated'])


class SharedCompactionTests(unittest.TestCase):
    def test_four_contenders_cancel_waiter_release_summary_before_generation_and_never_multiply_pool(self):
        from glitch.models import ModelClient, DECISION_SCHEMA
        from glitch.shared_runtime import SharedModelRuntime, ContextBudget
        runtime = SharedModelRuntime()
        runtime.process = MagicMock()
        runtime.process.poll.return_value = None
        runtime.snapshot.update(name='fixture', phase='ready', slots=4)
        runtime.budget = ContextBudget(65535)
        runtime.temperature = .15
        entered, release = threading.Event(), threading.Event()
        leases, peak, acquisition_order = {}, [], []
        acquire, free = runtime.budget.acquire, runtime.budget.release
        def acquire_checked(tokens, cancel):
            name = threading.current_thread().name
            self.assertNotIn(name, leases, 'Recursive generation while holding a summary lease')
            ticket = acquire(tokens, cancel)
            leases[name] = ticket
            acquisition_order.append(name)
            peak.append(runtime.budget.used)
            return ticket
        def free_checked(ticket):
            for name, lease in list(leases.items()):
                if lease is ticket:
                    leases.pop(name)
            free(ticket)
        runtime.budget.acquire = acquire_checked
        runtime.budget.release = free_checked

        class Response:
            status_code = 200
            def __init__(self, data=None, schema=None):
                self.data, self.schema = data, schema
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def raise_for_status(self):
                pass
            def json(self):
                return self.data
            def iter_lines(self, **_):
                entered.set()
                self.assert_wait = release.wait(5)
                if not self.assert_wait:
                    raise RuntimeError('Fixture release timed out')
                result = {'facts': []} if self.schema == SUMMARY_SCHEMA else {'done': True, 'message': 'Hello', 'tool': None}
                yield b'data: ' + json.dumps({'choices': [{'delta': {'content': json.dumps(result)}, 'finish_reason': 'stop'}]}).encode()
        class Client:
            def __enter__(self):
                return self
            def __exit__(self, *_):
                pass
            def post(self, url, json, **_):
                if url.endswith('/apply-template'):
                    return Response({'prompt': ''.join(m['role'] + ':' + m['content'] + '\n' for m in json['messages'])})
                if url.endswith('/tokenize'):
                    return Response({'tokens': list(range(len(json['content'])))})
                return Response(schema=json['response_format']['schema'])

        with tempfile.TemporaryDirectory() as root, patch.object(runtime, '_client', side_effect=Client):
            store = Store(Path(root) / 'data')
            models = ModelClient(store, runtime)
            settings = DEFAULTS | {'context_length': 65535, 'parallel_streams': 4, 'worker_model': 'fixture', 'mode': 'local'}
            sessions = [store.new_session(root) for _ in range(4)]
            for session in sessions:
                store.message(session, 'assistant', 'x' * 55000)
                store.message(session, 'user', 'Hello safely')
            cancellations = [threading.Event() for _ in sessions]
            outcomes = {}
            def run(index):
                try:
                    manager = ContextManager(store, models)
                    prompt = manager.prepare(sessions[index], {'role': 'system', 'content': 'Rules'}, None,
                                             settings, cancellations[index], lambda *_: None)
                    outcomes[index] = models.chat(settings, prompt, cancellations[index])
                except Exception as error:
                    outcomes[index] = error
            threads = [threading.Thread(target=run, args=(i,), name=f'context-{i}') for i in range(4)]
            try:
                threads[0].start()
                self.assertTrue(entered.wait(3))
                for thread in threads[1:]:
                    thread.start()
                    deadline = time.monotonic() + 3
                    while len(runtime.budget.waiters) < threads.index(thread) and time.monotonic() < deadline:
                        time.sleep(.01)
                self.assertEqual(len(runtime.budget.waiters), 3)
                started = time.monotonic()
                cancellations[1].set()
                threads[1].join(1)
                self.assertFalse(threads[1].is_alive())
                self.assertLess(time.monotonic() - started, 1)
                self.assertIsInstance(outcomes[1], InterruptedError)
                self.assertTrue(all(threads[i].is_alive() for i in (0, 2, 3)))
            finally:
                release.set()
                for thread in threads:
                    if thread.ident:
                        thread.join(5)
            self.assertTrue(all(not thread.is_alive() for thread in threads))
            for index in (0, 2, 3):
                self.assertIsInstance(outcomes[index], dict, str(outcomes[index]))
                self.assertTrue(outcomes[index]['done'])
            self.assertEqual(acquisition_order[:3], ['context-0', 'context-2', 'context-3'])
            self.assertLessEqual(max(peak), 65535)
            self.assertEqual(runtime.budget.total, 65535)
            self.assertEqual(runtime.budget.used, 0)
            self.assertEqual(runtime.active, 0)
            self.assertFalse(leases)
            self.assertIsNone(store.context_checkpoint(sessions[1]))


class ContextSmokeTests(unittest.TestCase):
    def test_source_smoke_is_isolated_and_writes_numeric_evidence(self):
        self.assertIsNotNone(importlib.util.find_spec('glitch.tests.smoke_context'), 'Context smoke harness is missing')
        from glitch.tests.smoke_context import run
        with tempfile.TemporaryDirectory() as root:
            output = Path(root, 'evidence.json')
            result = run(output)
            self.assertTrue(result['passed'])
            self.assertIsInstance(result['prompt_count'], int)
            self.assertEqual(json.loads(output.read_text())['prompt_count'], result['prompt_count'])
            self.assertEqual(result['tokenizer'], 'exact deterministic fixture, not a live model')



if __name__ == '__main__':
    unittest.main()
