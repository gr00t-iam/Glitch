"""Ordinary chat must not require a project selection or cloud credentials."""

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

from glitch.api import DesktopAPI
from glitch.models import ModelClient
from glitch.storage import Store


class ChatStartTests(unittest.TestCase):
    def test_new_chat_without_project_uses_managed_workspace(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            engine = Mock()
            engine.state.return_value = {'running_session': None}
            api = DesktopAPI(store, engine, Mock())
            session = api.new_conversation(None)
            self.assertTrue(Path(session['workspace']).is_dir())
            self.assertEqual(Path(session['workspace']).parent, (store.directory / 'workspaces').resolve())
            following = api.new_conversation(session['id'])
            self.assertEqual(following['workspace'], session['workspace'])
            self.assertNotEqual(following['id'], session['id'])

    def test_first_message_auto_loads_saved_local_model_without_cloud_key(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            settings = store.save_settings({'worker_model': 'saved.gguf', 'mode': 'local'})
            worker = Mock()
            worker.status.return_value = {'phase': 'unloaded', 'name': ''}
            worker.chat.return_value = {'message': 'Hello', 'done': True, 'tool': None}
            models = ModelClient(store, worker=worker)
            (models.library.directory / 'saved.gguf').write_bytes(b'GGUF' + (3).to_bytes(4, 'little') + bytes(24))
            result = models.chat(settings, [{'role': 'user', 'content': 'Hello'}], threading.Event())
            self.assertEqual(result['message'], 'Hello')
            worker.load.assert_called_once()

    def test_canceled_first_message_does_not_load(self):
        with tempfile.TemporaryDirectory() as root:
            worker = Mock()
            models = ModelClient(Store(Path(root)), worker=worker)
            cancel = threading.Event()
            cancel.set()
            with self.assertRaises(InterruptedError): models.chat({}, [], cancel)
            worker.load.assert_not_called()
