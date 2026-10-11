import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from glitch.computer import ComputerTools
from glitch.engine import AgentEngine
from glitch.storage import Store
from glitch.tools import WorkspaceTools


class AccessSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'data')
        self.engine = AgentEngine(self.store, None)
        self.engine.running_session = self.store.new_session(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_large_context_round_trips(self):
        for size in (65535, 65536, 131072):
            self.store.save_settings({'context_length': size})
            self.assertEqual(Store(self.root / 'data').settings()['context_length'], size)
        with self.assertRaises(ValueError):
            self.store.save_settings({'context_length': 131073})

    def test_full_access_is_explicit_boolean_and_persists(self):
        self.assertFalse(self.store.settings()['full_access'])
        for value in ('true', 1, None):
            with self.assertRaises(ValueError):
                self.store.save_settings({'full_access': value})
        self.store.save_settings({'full_access': True})
        self.assertTrue(Store(self.root / 'data').settings()['full_access'])
        self.store.save_settings({'full_access': False})
        self.assertFalse(self.store.settings()['full_access'])

    def test_full_access_computer_action_has_no_pending_prompt(self):
        self.store.save_settings({'full_access': True})
        tools = ComputerTools(self.root, self.engine._approve, self.engine._emit, self.engine.cancelled)
        with patch.object(self.engine.approval_event, 'wait', return_value=True), \
                patch.object(tools.chrome, 'action', return_value={'ok': True}) as action:
            tools.execute('browser_action', {'action': 'open', 'url': 'https://example.com'})
            action.assert_called_once()
        self.assertIsNone(self.engine.state()['approval'])
        self.assertTrue(any(e['payload'].get('automatic') for e in self.store.events(self.engine.running_session, 0)))

    def test_full_access_retains_path_and_command_boundaries(self):
        self.store.save_settings({'full_access': True})
        tools = WorkspaceTools(self.root, self.engine._approve, self.engine._emit, self.engine.cancelled)
        for name, args in [('write_file', {'path': '../outside.txt', 'content': 'blocked'}),
                           ('run_command', {'recipe': 'powershell -Command Remove-Item'})]:
            with self.assertRaises(ValueError):
                tools.execute(name, args)
        self.assertFalse((self.root.parent / 'outside.txt').exists())

    def test_stop_denies_even_with_full_access(self):
        self.store.save_settings({'full_access': True})
        self.engine.stop()
        self.assertFalse(self.engine._approve('desktop_click', {}))

    def test_turning_full_access_off_restores_the_gate(self):
        self.store.save_settings({'full_access': True})
        self.store.save_settings({'full_access': False})
        with patch.object(self.engine.approval_event, 'wait', return_value=True):
            self.assertFalse(self.engine._approve('desktop_input', {'action': 'click'}))
        self.assertTrue(any(e['kind'] == 'approval' for e in self.store.events(self.engine.running_session, 0)))
