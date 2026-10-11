import json
import tempfile
import threading
import unittest
from pathlib import Path

from glitch.storage import Store
from glitch.monitor import TriggerMonitor
from glitch.tools import WorkspaceTools
from glitch.engine import AgentEngine


class FakeModels:
    def __init__(self, decisions):
        self.decisions = iter(decisions)
        self.contexts = []
        self.reviews = []

    def chat(self, settings, messages, cancel):
        self.contexts.append(json.loads(json.dumps(messages)))
        return next(self.decisions)

    def review(self, settings, task, actions, reason, cancel):
        self.reviews.append(reason)
        return 'Inspect the real filename before retrying; never invent file contents.'


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.store = Store(self.root / 'data')
        self.session = self.store.new_session(str(self.workspace))

    def tearDown(self):
        self.temp.cleanup()

    def test_history_and_anchor_survive_restart(self):
        self.store.message(self.session, 'user', 'My project is called Glitch.')
        self.store.anchor(self.session, 'Verify before claiming success.')
        fresh = Store(self.root / 'data')
        self.assertEqual(fresh.messages(self.session)[0]['content'], 'My project is called Glitch.')
        self.assertEqual(fresh.anchors(self.session), ['Verify before claiming success.'])

    def test_monitor_cadence_error_and_loop(self):
        monitor = TriggerMonitor(5)
        self.assertIsNone(monitor.evaluate([{'tool': 'read_file', 'args': {'path': 'a'}, 'ok': True}]))
        self.assertIn('error', monitor.evaluate([{'tool': 'read_file', 'args': {}, 'ok': False}]))
        unique = [{'tool': 'read_file', 'args': {'path': str(i)}, 'ok': True} for i in range(5)]
        self.assertIn('5', monitor.evaluate(unique))
        self.assertIn('loop', monitor.evaluate([unique[0]] * 3))

    def test_denied_write_never_changes_file(self):
        tools = WorkspaceTools(self.workspace, lambda *_: False, lambda *_: None, threading.Event())
        result = tools.execute('write_file', {'path': 'a.txt', 'content': 'test'})
        self.assertTrue(result['denied'])
        self.assertFalse((self.workspace / 'a.txt').exists())

    def test_path_traversal_and_secret_reads_blocked(self):
        tools = WorkspaceTools(self.workspace, lambda *_: True, lambda *_: None, threading.Event())
        for path in ['../outside', '.env', '.git/config']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                tools.execute('read_file', {'path': path})

    def test_approved_write_emits_diff(self):
        tools = WorkspaceTools(self.workspace, lambda *_: True, lambda *_: None, threading.Event())
        result = tools.execute('write_file', {'path': 'notes/a.txt', 'content': 'hello\n'})
        self.assertTrue(result['ok'])
        self.assertIn('+hello', result['diff'])

    def test_hybrid_error_injects_anchor_before_next_worker_call(self):
        self.store.save_settings({'mode': 'hybrid'})
        fake = FakeModels([
            {'message': 'Reading', 'tool': {'name': 'read_file', 'args': {'path': 'missing'}}, 'done': False},
            {'message': 'I need the correct filename.', 'tool': None, 'done': True},
        ])
        engine = AgentEngine(self.store, fake)
        engine.run_sync(self.session, 'Inspect the project')
        self.assertEqual(len(fake.reviews), 1)
        self.assertIn('Inspect the real filename', fake.contexts[1][0]['content'])
        self.assertEqual(len(self.store.anchors(self.session)), 1)
        self.assertEqual(self.store.messages(self.session)[0]['content'], 'Inspect the project')

    def test_local_mode_has_no_supervisor_calls_and_preserves_previous_exchange(self):
        self.store.message(self.session, 'user', 'Remember the name Glitch.')
        self.store.message(self.session, 'assistant', 'The name is Glitch.')
        fake = FakeModels([{'message': 'Glitch', 'tool': None, 'done': True}])
        AgentEngine(self.store, fake).run_sync(self.session, 'What name did I use?')
        self.assertEqual(fake.reviews, [])
        self.assertTrue(any(m['content'] == 'Remember the name Glitch.' for m in fake.contexts[0]))

    def test_malformed_decision_is_not_reported_as_completed(self):
        fake = FakeModels([{'message': 'Done', 'done': 'false'}])
        AgentEngine(self.store, fake).run_sync(self.session, 'Inspect')
        events = self.store.events(self.session, 0)
        self.assertTrue(any(e['kind'] == 'error' for e in events))
        self.assertFalse(any(e['kind'] == 'completed' for e in events))


if __name__ == '__main__':
    unittest.main()
