"""Synthetic known credentials only; bounded tool preview regressions."""
import hashlib
import json
import sys
import threading
import unittest
from unittest.mock import Mock, patch

from glitch.tests import test_vault as fixtures
from glitch.tools import WorkspaceTools
from glitch.computer import ChromeController


SYNTHETIC = fixtures.SYNTHETIC


class PreviewTests(unittest.TestCase):
    def setUp(self):
        fixtures.VaultTests.setUp(self)
        fixtures.VaultTests.save(self)
        self.cancel = threading.Event()
        self.approve, self.emit = Mock(return_value=True), Mock()
        self.tools = WorkspaceTools(self.root, self.approve, self.emit, self.cancel)
        self.tools.vault = self.vault

    def test_read_cap_and_utf8_preserve_file(self):
        text = 'a' * 119990 + SYNTHETIC + '\u20ac' + 'tail' * 40000
        path = self.root / 'ordinary.txt'
        path.write_bytes(text.encode())
        result = self.tools.execute('read_file', {'path': path.name})
        self.assertTrue(result['truncated'])
        self.assertNotIn(SYNTHETIC[:10], result['content'])
        self.assertEqual(path.read_bytes(), text.encode())

    def test_readback_cap_preserves_actual_hash_and_bytes(self):
        text = 'a' * 119990 + SYNTHETIC + '\u20ac tail'
        data = text.encode()
        (self.root / 'artifact.txt').write_bytes(data)
        result = self.tools.readback('artifact.txt', hashlib.sha256(data).hexdigest())
        self.assertNotIn(SYNTHETIC[:10], result['content'])
        self.assertEqual(result['sha256'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['bytes'], len(data))

    def test_write_diff_masks_before_line_segmentation_and_cap(self):
        text = 'a' * 59940 + SYNTHETIC + '\n'
        result = self.tools.write({'path': 'edit.txt', 'content': text})
        self.assertNotIn(SYNTHETIC[:10], json.dumps(self.approve.call_args_list))
        self.assertNotIn(SYNTHETIC[:10], result['diff'])
        self.assertEqual((self.root / 'edit.txt').read_bytes(), text.encode())

    def test_stream_carry_and_partial_tail_are_masked(self):
        stream = self.vault.text_stream()
        value = stream.feed('before ' + SYNTHETIC[:12])
        value += stream.feed(SYNTHETIC[12:] + ' after') + stream.finish()
        self.assertEqual(value, 'before [credential removed] after')
        stream = self.vault.text_stream()
        value = stream.feed('before ' + SYNTHETIC[:12]) + stream.finish(incomplete=True)
        self.assertNotIn(SYNTHETIC[:12], value)
        for split in range(1, len(SYNTHETIC)):
            stream = self.vault.text_stream()
            value = stream.feed('before ' + SYNTHETIC[:split])
            value += stream.feed(SYNTHETIC[split:] + ' after') + stream.finish()
            self.assertEqual(value, 'before [credential removed] after')

    def test_command_decodes_utf8_across_read_chunk(self):
        script = "import sys;sys.stdout.buffer.write(('a'*4095+'\\u20ac'+" + repr(SYNTHETIC) + ").encode());sys.stdout.flush()"
        with patch.dict('glitch.tools.RECIPES', {'fixture': [sys.executable, '-c', script]}):
            result = self.tools.command('fixture')
        self.assertEqual(result['output'], 'a' * 4095 + '\u20ac[credential removed]')

    def test_cancelled_read_and_oversized_edit_are_refused(self):
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            self.tools.execute('read_file', {'path': 'ordinary.txt'})
        self.cancel.clear()
        (self.root / 'large.txt').write_bytes(b'x' * 1_000_001)
        with self.assertRaises(ValueError):
            self.tools.write({'path': 'large.txt', 'content': 'replacement'})
        self.approve.assert_not_called()

    def test_command_chunk_cap_and_utf8_events_are_safe(self):
        script = "import sys;sys.stdout.buffer.write(('a'*4090+" + repr(SYNTHETIC) + "+'\\u20ac'+'b'*115870+" + repr(SYNTHETIC) + "+'tail').encode());sys.stdout.flush()"
        with patch.dict('glitch.tools.RECIPES', {'fixture': [sys.executable, '-c', script]}):
            result = self.tools.command('fixture')
        self.assertTrue(result['ok'])
        joined = ''.join(call.args[2]['text'] for call in self.emit.call_args_list)
        self.assertEqual(joined, result['output'])
        self.assertIn('\u20ac', joined)
        self.assertNotIn(SYNTHETIC[:10], joined)
        self.assertLessEqual(len(joined), 120000)

    def test_chrome_cap_after_redaction_with_bounded_dom_request(self):
        controller = ChromeController(self.root, self.cancel)
        controller.vault = self.vault
        socket = Mock()
        text = 'a' * 17990 + SYNTHETIC + 'tail'
        socket.recv.return_value = json.dumps({'id': 1, 'result': {'result': {'value': text}}})
        pages = [{'id': 'fixture', 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture'}]
        with patch.object(controller, 'ensure', return_value=pages), \
                patch('websocket.create_connection', return_value=socket):
            result = controller.action({'action': 'text'})
        self.assertNotIn(SYNTHETIC[:10], result['value'])
        self.assertLessEqual(len(result['value']), 18000)
        self.assertNotIn('slice(0,18000)', socket.send.call_args.args[0])
