import tempfile
import threading
import time
import unittest
from pathlib import Path
from glitch.storage import Store
from glitch.orchestration import AgentCoordinator


class CoordinatorTests(unittest.TestCase):
    def test_capacity_and_independent_stop(self):
        class Models:
            def chat(self, settings, messages, cancel):
                while not cancel.wait(.01):
                    pass
                raise InterruptedError()
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'data')
            store.save_settings({'parallel_streams': 4})
            engine = AgentCoordinator(store, Models())
            sessions = [store.new_session(folder) for _ in range(5)]
            ids = [engine.start(s, 'Wait') for s in sessions[:4]]
            with self.assertRaises(ValueError):
                engine.start(sessions[4], 'Fifth')
            engine.stop(ids[0])
            deadline = time.monotonic() + 3
            while engine.active_session(sessions[0]) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(engine.active_session(sessions[0]))
            self.assertTrue(all(engine.active_session(s) for s in sessions[1:4]))
            engine.close()

    def test_parent_child_completion_and_history_isolation(self):
        class Models:
            def chat(self, settings, messages, cancel):
                prompt = next(m['content'] for m in messages if m['role'] == 'user')
                if prompt == 'child job':
                    return {'done': True, 'tool': None, 'message': 'Child evidence'}
                import json
                feedback = [m for m in messages if m['content'].startswith('Verified tool result')]
                if not feedback:
                    return {'done': False, 'message': 'Delegating', 'tool': {'name': 'spawn_subagent', 'args': {'role': 'Researcher', 'task': 'child job'}}}
                if len(feedback) == 1:
                    result = json.loads(feedback[0]['content'].split('\n', 1)[1])['result']
                    return {'done': False, 'message': 'Waiting', 'tool': {'name': 'await_subagent', 'args': {'run_id': result['run_id']}}}
                return {'done': True, 'tool': None, 'message': 'Parent evidence'}
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'data')
            store.save_settings({'parallel_streams': 2})
            engine = AgentCoordinator(store, Models())
            completed = []
            engine.subscribe_completion(completed.append)
            session = store.new_session(folder)
            identifier = engine.start(session, 'parent job')
            deadline = time.monotonic() + 5
            while engine.active_session(session) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(engine.active_session(session))
            self.assertEqual(engine.runs[identifier]['status'], 'completed')
            child = next(r for r in engine.runs.values() if r['parent_id'])
            self.assertFalse(any(m['content'] == 'parent job' for m in store.messages(child['session'])))
            self.assertEqual(len(completed), 2)
            engine.close()

    def test_approvals_are_scoped_to_their_run(self):
        class Models:
            def chat(self, settings, messages, cancel):
                if messages[-1]['content'].startswith('Verified tool result'):
                    return {'done': True, 'tool': None, 'message': 'Verified'}
                return {'done': False, 'message': 'Write', 'tool': {'name': 'write_file', 'args': {'path': messages[-1]['content'], 'content': 'safe'}}}
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'data')
            store.save_settings({'parallel_streams': 2})
            engine = AgentCoordinator(store, Models())
            sessions = [store.new_session(folder) for _ in range(2)]
            engine.start(sessions[0], 'first.txt')
            engine.start(sessions[1], 'second.txt')
            deadline = time.monotonic() + 3
            while len(engine.state()['approvals']) < 2 and time.monotonic() < deadline:
                time.sleep(.01)
            pending = engine.state()['approvals']
            self.assertEqual(len(pending), 2)
            first = next(p for p in pending if p['payload']['path'] == 'first.txt')
            engine.resolve_approval(first['id'], True)
            deadline = time.monotonic() + 3
            while engine.active_session(sessions[0]) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue((Path(folder) / 'first.txt').exists())
            self.assertFalse((Path(folder) / 'second.txt').exists())
            engine.close()
