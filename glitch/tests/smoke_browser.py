"""Local-only integration probe against a disposable Chrome profile on port 9222."""

import base64
import json
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def run(output_directory):
    from glitch.computer import ChromeController
    import psutil
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_GET(self):
            content = b'<!doctype html><html><body><h1>Glitch Chrome verification</h1><input id="note"><button id="save" onclick="document.getElementById(\'result\').textContent=document.getElementById(\'note\').value">Save</button><p id="result"></p></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    result = {'passed': False}
    with tempfile.TemporaryDirectory(prefix='glitch-chrome-') as folder:
        controller = ChromeController(folder)
        try:
            assert controller.action({'action': 'open', 'url': f'http://127.0.0.1:{server.server_port}'})['ok']
            for _ in range(40):
                if 'Glitch Chrome verification' in controller.action({'action': 'text'}).get('value', ''):
                    break
                time.sleep(0.2)
            else:
                raise AssertionError('Test page did not load')
            controller.action({'action': 'fill', 'selector': '#note', 'text': 'Approved Glitch test'})
            controller.action({'action': 'click', 'selector': '#save'})
            assert 'Approved Glitch test' in controller.action({'action': 'text'})['value']
            screenshot = controller.action({'action': 'screenshot'})['_image']
            (output / 'browser.png').write_bytes(base64.b64decode(screenshot))
            result = {'passed': True, 'checks': ['Chrome launched with isolated profile on 9222', 'Navigation, visible text, CSS fill and click work', 'CDP screenshot captured']}
        except Exception as error:
            result['error'] = str(error)
        finally:
            # Only terminate processes belonging to this disposable test profile.
            profile_arg = f'--user-data-dir={controller.profile}'
            for process in psutil.process_iter(['name', 'cmdline']):
                try:
                    if profile_arg in (process.info['cmdline'] or []):
                        children = process.children(recursive=True)
                        for child in children:
                            try:
                                child.terminate()
                            except psutil.NoSuchProcess:
                                pass
                        process.terminate()
                        psutil.wait_procs(children + [process], timeout=8)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            (output / 'result.json').write_text(json.dumps(result, indent=2))
    server.shutdown()
    server.server_close()
    return result
