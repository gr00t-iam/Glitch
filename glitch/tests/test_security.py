import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from glitch.computer import ComputerTools
from glitch.discord_bot import authorized
from glitch.engine import AgentEngine
from glitch.storage import Store, protect
from glitch.tools import WorkspaceTools


class SecurityTests(unittest.TestCase):
    def test_discord_wrong_owner_or_channel_is_rejected(self):
        self.assertTrue(authorized(123, 456, '123', '456', False))
        self.assertFalse(authorized(999, 456, '123', '456', False))
        self.assertFalse(authorized(123, 999, '123', '456', False))
        self.assertFalse(authorized(123, 456, '123', '', False))
        self.assertTrue(authorized(123, 456, '123', '', True))

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI')
    def test_credentials_round_trip_without_plaintext(self):
        encrypted = protect(b'example-private-credential')
        self.assertNotIn(b'example-private-credential', encrypted)
        self.assertEqual(protect(encrypted, decrypt=True), b'example-private-credential')

    def test_denied_computer_action_never_touches_host(self):
        with tempfile.TemporaryDirectory() as folder:
            tools = ComputerTools(Path(folder), lambda *_: False, lambda *_: None, threading.Event())
            with patch.object(tools.chrome, 'action') as action:
                result = tools.execute('browser_action', {'action': 'open', 'url': 'https://example.com'})
                self.assertTrue(result['denied'])
                action.assert_not_called()

    def test_cancel_unblocks_approval_and_denies_action(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'data')
            engine = AgentEngine(store, None)
            engine.running_session = store.new_session(folder)
            results = []
            thread = threading.Thread(target=lambda: results.append(engine._approve('write', {'path': 'a'})))
            thread.start()
            for _ in range(100):
                if engine.state()['approval']:
                    break
                threading.Event().wait(0.01)
            self.assertIsNotNone(engine.state()['approval'])
            engine.stop()
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(results, [False])

    def test_arbitrary_command_recipe_blocked_before_approval(self):
        with tempfile.TemporaryDirectory() as folder:
            calls = []
            tools = WorkspaceTools(folder, lambda *args: calls.append(args), lambda *_: None, threading.Event())
            with self.assertRaises(ValueError):
                tools.execute('run_command', {'recipe': 'powershell -Command Remove-Item'})
            self.assertEqual(calls, [])

    def test_redaction_keeps_valid_json_and_hides_named_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder))
            session = store.new_session(folder)
            store.event(session, 'tool', 'Result', {'api_key': 'fake-secret', 'text': 'token: abc password: xyz'})
            payload = store.events(session, 0)[0]['payload']
            self.assertNotIn('abc', payload['text'])
            self.assertNotIn('xyz', payload['text'])
            self.assertEqual(payload['api_key'], '[credential removed]')

    def test_write_conflict_after_approval_does_not_overwrite_external_edit(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'a.txt'
            path.write_text('old')
            def approve(*_):
                path.write_text('external')
                return True
            tools = WorkspaceTools(folder, approve, lambda *_: None, threading.Event())
            with self.assertRaises(ValueError):
                tools.execute('write_file', {'path': 'a.txt', 'content': 'worker'})
            self.assertEqual(path.read_text(), 'external')


if __name__ == '__main__':
    unittest.main()
