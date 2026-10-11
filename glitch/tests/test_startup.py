import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from glitch.storage import Store


class StartupTests(unittest.TestCase):
    def test_ollama_bind_and_client_addresses(self):
        cases = {
            '0.0.0.0': 'http://127.0.0.1:11434',
            '0.0.0.0:12345': 'http://127.0.0.1:12345',
            'localhost': 'http://localhost:11434',
            'localhost:11434': 'http://localhost:11434',
            '[::]:11434': 'http://[::1]:11434',
            '::1': 'http://[::1]:11434',
            'https://models.example.com': 'https://models.example.com',
            'http://0.0.0.0:11434': 'http://127.0.0.1:11434',
        }
        for host, expected in cases.items():
            with self.subTest(host=host), tempfile.TemporaryDirectory() as folder:
                store = Store(Path(folder))
                with patch.dict(os.environ, {'OLLAMA_HOST': host}, clear=True):
                    store.import_environment()
                self.assertEqual(store.settings()['ollama_url'], expected)

    def test_bad_optional_environment_does_not_prevent_startup(self):
        for host in ('http://user:secret@localhost', 'ftp://localhost',
                     'localhost:invalid', 'http://localhost?token=secret', '[invalid'):
            with self.subTest(host=host), tempfile.TemporaryDirectory() as folder:
                store = Store(Path(folder))
                store.save_settings({'ollama_url': 'http://localhost:12345'})
                with patch.dict(os.environ, {'OLLAMA_HOST': host,
                                            'DISCORD_USER_ID': 'not-an-id'}, clear=True):
                    warnings = store.import_environment()
                self.assertEqual(store.settings()['ollama_url'], 'http://localhost:12345')
                self.assertEqual(len(warnings), 2)
                self.assertNotIn('secret', str(warnings))

    def test_invalid_discord_override_does_not_discard_valid_ollama(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder))
            with patch.dict(os.environ, {'OLLAMA_HOST': '0.0.0.0',
                                        'DISCORD_CHANNEL_ID': 'invalid'}, clear=True):
                warnings = store.import_environment()
            self.assertEqual(store.settings()['ollama_url'], 'http://127.0.0.1:11434')
            self.assertEqual(len(warnings), 1)
