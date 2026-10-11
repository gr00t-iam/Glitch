"""Exercise real WebView2, native bridge, HTTP transport and approval UI in isolation."""

import json
import base64
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def run(output_directory):
    import webview
    from glitch.api import DesktopAPI
    from glitch.engine import AgentEngine
    from glitch.models import ModelClient
    from glitch.storage import Store
    from glitch.main import install_navigation_guard
    from glitch.discord_bot import DiscordGateway

    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    class OllamaFixture(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            last = data['messages'][-1]['content']
            decision = {'message': 'The note has been written and verified.', 'tool': None, 'done': True} if last.startswith('Verified tool result') else {
                'message': 'I will create a note after your approval.', 'done': False,
                'tool': {'name': 'write_file', 'args': {'path': 'note.txt', 'content': 'Glitch desktop smoke test\n'}},
            }
            content = json.dumps({'message': {'content': json.dumps(decision)}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    server = ThreadingHTTPServer(('127.0.0.1', 0), OllamaFixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='glitch-smoke-') as temporary:
        root = Path(temporary)
        project = root / 'project'
        project.mkdir()
        store = Store(root / 'data')
        store.save_settings({'worker_model': 'fixture', 'ollama_url': f'http://127.0.0.1:{server.server_port}'})
        session = store.new_session(str(project))
        models = ModelClient(store)
        engine = AgentEngine(store, models)
        api = DesktopAPI(store, engine, models)
        api._discord = DiscordGateway(store, engine)
        window = webview.create_window('Glitch - Desktop verification',
            str(Path(__file__).resolve().parents[1] / 'ui' / 'index.html'), js_api=api,
            width=1200, height=800, x=40, y=40, background_color='#101216')
        api._window = window

        def wait_for(expression, timeout=20):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if window.evaluate_js(expression):
                    return
                time.sleep(0.1)
            raise AssertionError('Desktop condition timed out: ' + expression)

        def probe():
            try:
                wait_for("document.getElementById('model-label').textContent === 'fixture'")
                wait_for("document.querySelectorAll('.session').length === 1")
                result['checks'].append('Bundled UI and native bridge initialized')
                install_navigation_guard(window)
                window.evaluate_js("location.href='https://example.invalid/'")
                time.sleep(0.3)
                assert window.evaluate_js("document.getElementById('model-label').textContent === 'fixture'")
                result['checks'].append('External navigation cannot acquire the native bridge')
                window.evaluate_js("document.getElementById('settings-open').click()")
                wait_for("document.getElementById('settings-dialog').open")
                window.evaluate_js("document.getElementById('tab-discord').click()")
                wait_for("!document.getElementById('settings-discord').hidden")
                window.evaluate_js("document.getElementById('settings-close').click()")
                result['checks'].append('Settings dialog and Discord tab work')
                window.evaluate_js("document.getElementById('prompt').value='Create a note';document.getElementById('composer').requestSubmit()")
                wait_for("document.getElementById('approval-dialog').open")
                assert not (project / 'note.txt').exists()
                result['checks'].append('File write blocks before approval')
                window.evaluate_js("document.getElementById('approve').click()")
                wait_for("document.getElementById('status').textContent.includes('completed')")
                assert (project / 'note.txt').read_text() == 'Glitch desktop smoke test\n'
                result['checks'].append('Approved write executes through real HTTP worker transport')
                messages = store.messages(session)
                assert any(m['role'] == 'context' for m in messages)
                result['checks'].append('Verified tool evidence persists across turns')
                layout = window.evaluate_js("(()=>{const a=document.querySelector('.sidebar').getBoundingClientRect(),b=document.querySelector('main').getBoundingClientRect(),c=document.querySelector('.timeline').getBoundingClientRect();return {width:innerWidth,height:innerHeight,sidebar:a.right,main:b.left,timeline:c.width,owl:document.querySelector('.brand img').naturalWidth,overflow:document.documentElement.scrollWidth>innerWidth}})()")
                assert layout['sidebar'] <= layout['main'] and layout['owl'] > 0 and not layout['overflow'], layout
                result['layout'] = layout
                result['checks'].append('Owl asset renders; workspace has no horizontal overlap')
                # Capture this WebView's pixels directly, even if another app covers the window.
                from System import Action
                capture = []
                window.native.Invoke(Action(lambda: capture.append(window.native.webview.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', '{}'))))
                screenshot = json.loads(str(capture[0].Result))
                (output / 'desktop.png').write_bytes(base64.b64decode(screenshot['data']))
                result['passed'] = True
            except Exception as error:
                result['error'] = str(error)
            finally:
                engine.stop()
                (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
                window.destroy()

        probed = threading.Event()
        def loaded():
            if not probed.is_set():
                probed.set()
                threading.Thread(target=probe, daemon=True).start()
        window.events.loaded += loaded
        webview.start(gui='edgechromium', private_mode=True, debug=False)
    server.shutdown()
    server.server_close()
    return result
