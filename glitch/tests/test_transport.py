import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from glitch.models import ModelClient
from glitch.storage import Store
from glitch.tools import WorkspaceTools


class TransportTests(unittest.TestCase):
    def test_embedded_worker_and_supervisor_payloads(self):
        captured = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def respond(self, data):
                raw = json.dumps(data).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            def do_GET(self):
                self.respond({'models': [{'name': 'fixture', 'size': 123}]})
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                captured.append((self.path, body, self.headers.get('Authorization')))
                if self.path.endswith('/api/chat'):
                    self.respond({'message': {'content': json.dumps({'message': 'Hello', 'tool': None, 'done': True})}})
                else:
                    self.respond({'choices': [{'message': {'content': 'Verify the real path.'}}]})
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                store = Store(Path(folder))
                url = f'http://127.0.0.1:{server.server_port}'
                settings = store.save_settings({'worker_model': 'fixture', 'ollama_url': url, 'supervisor_url': url})
                class Worker:
                    def status(self): return {'phase': 'ready', 'name': 'fixture'}
                    def chat(self, messages, schema, cancel):
                        self.messages, self.schema = messages, schema
                        return {'message': 'Hello', 'tool': None, 'done': True}
                worker = Worker()
                client = ModelClient(store, worker=worker)
                self.assertEqual(client.discover(settings), [])
                decision = client.chat(settings, [{'role': 'user', 'content': 'Hello'}], threading.Event())
                self.assertTrue(decision['done'])
                with patch.object(store, 'supervisor_key', return_value='test-key'):
                    directive = client.review(settings, 'Inspect', [{'tool':'read_file','args':{},'ok':False,'result':{'text':'password: secret'}}], 'tool error', threading.Event())
                self.assertEqual(directive, 'Verify the real path.')
                self.assertEqual(captured[0][2], 'Bearer test-key')
                self.assertNotIn('password: secret', json.dumps(captured[0][1]))
                self.assertEqual(len(captured), 1, 'Local inference must not send HTTP requests')
                self.assertEqual(worker.messages[0]['content'], 'Hello')
                self.assertIn('tool', worker.schema['properties'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_fixed_shell_recipe_streams_real_output(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'glitch-stream-test.txt').write_text('test')
            events = []
            tools = WorkspaceTools(folder, lambda *_: True, lambda *args: events.append(args), threading.Event())
            result = tools.execute('run_command', {'recipe': 'list_directory'})
            self.assertTrue(result['ok'], result)
            self.assertIn('glitch-stream-test.txt', result['output'])
            self.assertTrue(any(event[0] == 'output' for event in events))


if __name__ == '__main__':
    unittest.main()
