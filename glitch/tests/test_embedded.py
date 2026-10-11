import hashlib
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from glitch.model_manager import ModelManager, validate_download_url
from glitch.local_inference import prepare_messages
from glitch.supervisor import loopback_url, SupervisorBridge
from glitch.storage import Store


class EmbeddedTests(unittest.TestCase):
    def test_download_boundaries(self):
        for url in ('http://huggingface.co/x.gguf', 'https://evil.example/x.gguf',
                    'https://huggingface.co@evil.example/x.gguf', 'https://huggingface.co/x.gguf?token=secret'):
            with self.assertRaises(ValueError):
                validate_download_url(url)
        self.assertEqual(validate_download_url('https://huggingface.co/a/b/resolve/main/test.gguf'), 'test.gguf')

    def test_atomic_download_and_checksum(self):
        data = b'GGUF' + (3).to_bytes(4, 'little') + bytes(24)
        class Response:
            status_code = 200
            headers = {'Content-Length': str(len(data))}
            def close(self): pass
            def iter_content(self, _): yield data[:8]; yield data[8:]
        with tempfile.TemporaryDirectory() as root:
            manager = ModelManager(Path(root))
            with patch('glitch.model_manager.requests.get', return_value=Response()):
                manager.download('https://huggingface.co/a/b/resolve/main/test.gguf', hashlib.sha256(data).hexdigest())
                manager.wait(5)
            self.assertEqual(manager.status()['phase'], 'complete')
            self.assertEqual(manager.catalog()[0]['size'], len(data))
            with self.assertRaises(ValueError): manager.path('../escape.gguf')
            with patch('glitch.model_manager.requests.get', return_value=Response()):
                manager.download('https://huggingface.co/a/b/resolve/main/bad.gguf', '0' * 64)
                manager.wait(5)
            self.assertEqual(manager.status()['phase'], 'error')
            self.assertFalse((Path(root) / 'bad.gguf').exists())
            self.assertFalse(list(Path(root).glob('*.part')))

    def test_text_model_must_not_pretend_to_see_screenshot(self):
        messages = [{'role': 'user', 'content': 'Inspect this', 'images': ['YWJj']}]
        with self.assertRaises(ValueError): prepare_messages(messages, False)
        converted = prepare_messages(messages, True)
        self.assertEqual(converted[0]['content'][1]['image_url']['url'], 'data:image/png;base64,YWJj')

    def test_canceled_transfer_never_publishes_model(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ModelManager(Path(root))
            def transfer():
                yield b'GGUF' + (3).to_bytes(4, 'little') + bytes(24)
                manager.cancel()
                yield b'canceled'
            manager._start('cancel.gguf', transfer)
            manager.wait(5)
            self.assertEqual(manager.status()['phase'], 'canceled')
            self.assertEqual(manager.catalog(), [])
            self.assertFalse(list(Path(root).glob('*.part')))

    def test_malformed_file_and_truncated_transfer_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            manager = ModelManager(Path(root))
            manager._start('html.gguf', lambda: iter([b'<html>not a model</html>']))
            manager.wait(5)
            self.assertEqual(manager.status()['phase'], 'error')
            def truncated():
                manager._update(total=1000)
                yield b'GGUF' + (3).to_bytes(4, 'little') + bytes(24)
            manager._start('truncated.gguf', truncated)
            manager.wait(5)
            self.assertIn('Incomplete', manager.status()['message'])
            self.assertEqual(manager.catalog(), [])

    def test_symlink_cannot_escape_model_library(self):
        with tempfile.TemporaryDirectory() as root:
            outside = Path(root) / 'outside.gguf'
            outside.write_bytes(b'GGUF' + (3).to_bytes(4, 'little') + bytes(24))
            manager = ModelManager(Path(root) / 'models')
            try:
                (manager.directory / 'link.gguf').symlink_to(outside)
            except OSError:
                self.skipTest('Symlinks require Windows Developer Mode or administrator privileges.')
            self.assertEqual(manager.catalog(), [])
            with self.assertRaises(ValueError): manager.path('link.gguf')

    def test_native_anthropic_schema_and_authentication(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            settings = store.save_settings({'supervisor_provider': 'anthropic',
                'supervisor_url': 'https://api.anthropic.com/v1', 'supervisor_model': 'claude-test'})
            class Response:
                ok = True
                def __enter__(self): return self
                def __exit__(self, *_): pass
                def json(self): return {'content': [{'type': 'text', 'text': 'Verify the result.'}]}
            with patch.object(store, 'supervisor_key', return_value='api-test-key'), \
                    patch('glitch.supervisor.requests.post', return_value=Response()) as post:
                self.assertEqual(SupervisorBridge(store).review(settings, 'task', [], 'error', threading.Event()), 'Verify the result.')
            self.assertEqual(post.call_args.args[0], 'https://api.anthropic.com/v1/messages')
            headers = post.call_args.kwargs['headers']
            self.assertEqual(headers['x-api-key'], 'api-test-key')
            self.assertNotIn('Authorization', headers)
            self.assertIn('system', post.call_args.kwargs['json'])
            self.assertEqual(post.call_args.kwargs['json']['messages'][0]['role'], 'user')

    def test_inference_settings_limits_and_protected_bridge_token(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            for update in ({'context_length': 200000}, {'cpu_threads': 0}, {'temperature': float('nan')},
                           {'proxy_url': 'https://remote.example/v1'}, {'supervisor_auth': 'fake-oauth'}):
                with self.assertRaises((ValueError, OverflowError)):
                    store.save_settings(update)
            settings = store.save_settings({'proxy_token': 'bridge-secret-value'})
            self.assertTrue(settings['proxy_token_saved'])
            self.assertNotIn('bridge-secret-value', json_string(settings))
            self.assertEqual(store.proxy_token(), 'bridge-secret-value')
            self.assertNotIn(b'bridge-secret-value', (Path(root) / 'proxy.dpapi').read_bytes())
            store.save_settings({'clear_proxy_token': True})
            self.assertEqual(store.proxy_token(), '')

    def test_proxy_is_loopback_only(self):
        for url in ('http://example.com/v1', 'http://127.0.0.1.evil/v1', 'http://user:pass@localhost/v1',
                    'http://0.0.0.0/v1', 'http://localhost/v1?key=secret', 'file:///C:/secret'):
            with self.assertRaises(ValueError): loopback_url(url)
        self.assertEqual(loopback_url('http://127.0.0.1:8317/v1/'), 'http://127.0.0.1:8317/v1')

    def test_proxy_does_not_require_or_leak_cloud_key(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            settings = store.save_settings({'supervisor_auth': 'proxy', 'proxy_model': 'authorized-model'})
            class Response:
                ok = True
                def __enter__(self): return self
                def __exit__(self, *_): pass
                def json(self): return {'choices': [{'message': {'content': 'Read the actual file.'}}]}
            with patch.object(store, 'supervisor_key', side_effect=AssertionError('Cloud key was accessed')), \
                    patch('glitch.supervisor.requests.post', return_value=Response()) as post:
                directive = SupervisorBridge(store).review(settings, 'Task', [], 'error', threading.Event())
            self.assertEqual(directive, 'Read the actual file.')
            self.assertNotIn('Authorization', post.call_args.kwargs['headers'])
            self.assertTrue(post.call_args.args[0].startswith('http://127.0.0.1:'))


def json_string(value):
    import json
    return json.dumps(value)
