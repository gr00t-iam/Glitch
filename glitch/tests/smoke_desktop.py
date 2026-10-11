"""Exercise real WebView2 and approval UI with deterministic worker decisions."""

import json
import base64
import tempfile
import threading
import time
from pathlib import Path


def run(output_directory):
    import webview
    from glitch.desktop_runtime import install_webview_cleanup_guard
    install_webview_cleanup_guard()
    from glitch.api import DesktopAPI
    from glitch.engine import AgentEngine
    from glitch.models import ModelClient
    from glitch.storage import Store
    from glitch.main import install_navigation_guard
    from glitch.discord_bot import DiscordGateway

    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    with tempfile.TemporaryDirectory(prefix='glitch-smoke-') as temporary:
        root = Path(temporary)
        project = root / 'project'
        project.mkdir()
        store = Store(root / 'data')
        store.import_environment()
        result['checks'].append('Production environment import completes before native window initialization')
        store.save_settings({'worker_model': 'fixture.gguf'})
        session = store.new_session(str(project))
        class FixtureWorker:
            loaded = True
            def status(self):
                return {'phase': 'ready' if self.loaded else 'unloaded', 'name': 'fixture.gguf' if self.loaded else '', 'message': 'Fixture ready', 'usage': {}}
            def close(self): self.loaded = False
            def load(self, *_): self.loaded = True
            def chat(self, messages, schema, cancel):
                last = messages[-1]['content']
                return {'message': 'The note has been written and verified.', 'tool': None, 'done': True} if last.startswith('Verified tool result') else {
                    'message': 'I will create a note after your approval.', 'done': False,
                    'tool': {'name': 'write_file', 'args': {'path': 'note.txt', 'content': 'Glitch desktop smoke test\n'}}}
        models = ModelClient(store, worker=FixtureWorker())
        (models.library.directory / 'fixture.gguf').write_bytes(b'GGUF' + (3).to_bytes(4, 'little') + bytes(24))
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
                wait_for("document.getElementById('model-label').textContent === 'fixture.gguf'")
                wait_for("document.querySelectorAll('.session').length === 1")
                result['checks'].append('Bundled UI and native bridge initialized')
                install_navigation_guard(window)
                window.evaluate_js("location.href='https://example.invalid/'")
                time.sleep(0.3)
                assert window.evaluate_js("document.getElementById('model-label').textContent === 'fixture.gguf'")
                result['checks'].append('External navigation cannot acquire the native bridge')
                window.evaluate_js("document.getElementById('settings-open').click()")
                wait_for("document.getElementById('settings-dialog').open")
                wait_for("document.getElementById('worker-model').value === 'fixture.gguf'")
                window.evaluate_js("document.getElementById('unload-model').click()")
                wait_for("document.getElementById('inference-status').textContent === 'Fixture ready'")
                window.evaluate_js("document.getElementById('load-model').click()")
                wait_for("document.getElementById('save-result').textContent === 'Saved locally'")
                wait_for("document.getElementById('inference-status').textContent.includes('fixture.gguf')")
                result['checks'].append('Model library selector and load/unload controls work through the native bridge')
                window.evaluate_js("document.getElementById('tab-supervisor').click();document.getElementById('supervisor-auth').value='proxy';document.getElementById('supervisor-auth').dispatchEvent(new Event('change'))")
                wait_for("!document.getElementById('proxy-fields').hidden && document.getElementById('api-fields').hidden")
                result['checks'].append('Subscription bridge fields replace developer API fields without exposing credentials')
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
                result['checks'].append('Approved write executes through deterministic embedded-worker interface')
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
                # Reproduce a disposed control before FormClosed cleanup.
                from System import Action
                window.native.Invoke(Action(lambda: window.native.webview.Dispose()))
                window.destroy()

        probed = threading.Event()
        def loaded():
            if not probed.is_set():
                probed.set()
                threading.Thread(target=probe, daemon=True).start()
        window.events.loaded += loaded
        webview.start(gui='edgechromium', private_mode=True, debug=False)
        result['checks'].append('Disposed WebView2 closes without a framework exception')
        (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result
