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
        class FixtureWorker:
            loaded = True
            def status(self):
                return {'phase': 'ready' if self.loaded else 'unloaded', 'name': 'fixture.gguf' if self.loaded else '', 'message': 'Fixture ready', 'usage': {}}
            def close(self): self.loaded = False
            def load(self, *_): self.loaded = True
            def count_prompt(self, messages, cancel):
                if cancel.is_set():
                    raise InterruptedError('Stopped')
                return len(json.dumps(messages).encode('utf-8')) // 8
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
                wait_for("document.querySelectorAll('.session').length === 0 && !document.getElementById('send').disabled")
                result['checks'].append('Send is enabled on a fresh install without a project or conversation')
                result['checks'].append('Bundled UI and native bridge initialized')
                assert window.evaluate_js("!document.getElementById('read-reply') && document.querySelector('#microphone .icon-mic') && getComputedStyle(document.querySelector('#microphone .icon-mic')).maskImage.includes('mic.svg') && document.querySelector('#send .icon-send')")
                assert window.evaluate_js("document.getElementById('composer-access').getAttribute('aria-pressed') === 'false'")
                result['checks'].append('Composer renders microphone and arrow icons, inline access control, and no Read reply button')
                install_navigation_guard(window)
                window.evaluate_js("location.href='https://example.invalid/'")
                time.sleep(0.3)
                assert window.evaluate_js("document.getElementById('model-label').textContent === 'fixture.gguf'")
                result['checks'].append('External navigation cannot acquire the native bridge')
                window.evaluate_js("document.getElementById('settings-open').click()")
                wait_for("document.getElementById('settings-dialog').open")
                wait_for("document.getElementById('worker-model').value === 'fixture.gguf'")
                assert window.evaluate_js("(()=>{const before={...state.settings};try{state.settings.vision_projector='projector.gguf';renderLibrary([{name:'fixture.gguf',size:32},{name:'other.gguf',size:32},{name:'projector.gguf',size:32}],true);document.getElementById('vision-projector').value='projector.gguf';document.getElementById('vision-projector').value='';document.getElementById('worker-model').value='other.gguf';document.getElementById('worker-model').dispatchEvent(new Event('change'));return document.getElementById('vision-projector').value==='';}finally{state.settings=before;document.getElementById('worker-model').value=before.worker_model;renderLibrary([{name:'fixture.gguf',size:32}],true);}})()"), 'Changing models restored a deliberately cleared projector'
                result['checks'].append('Changing models preserves an explicit Text / browser DOM only projector selection')
                window.evaluate_js("document.getElementById('unload-model').click()")
                wait_for("document.getElementById('inference-status').textContent === 'Fixture ready'")
                window.evaluate_js("document.getElementById('load-model').click()")
                wait_for("document.getElementById('save-result').textContent === 'Saved locally'")
                wait_for("document.getElementById('inference-status').textContent.includes('fixture.gguf')")
                result['checks'].append('Model library selector and load/unload controls work through the native bridge')
                window.evaluate_js("document.getElementById('context-length').value='131073';document.getElementById('settings-form').requestSubmit()")
                assert window.evaluate_js("document.getElementById('settings-dialog').open && !document.getElementById('context-length').checkValidity()")
                assert store.settings()['context_length'] == 4096
                window.evaluate_js("document.getElementById('context-length').value='65535';document.getElementById('settings-form').requestSubmit()")
                wait_for("!document.getElementById('settings-dialog').open")
                assert store.settings()['context_length'] == 65535
                assert window.evaluate_js("document.getElementById('cache-allocation').textContent.includes('one 65,535-token pool')")
                result['checks'].append('65,535-token context saves and closes Settings; invalid context leaves it open')
                window.evaluate_js("document.getElementById('settings-open').click()")
                wait_for("document.getElementById('settings-dialog').open")
                window.evaluate_js("document.getElementById('tab-supervisor').click();document.getElementById('supervisor-auth').value='proxy';document.getElementById('supervisor-auth').dispatchEvent(new Event('change'))")
                wait_for("!document.getElementById('proxy-fields').hidden && document.getElementById('api-fields').hidden")
                result['checks'].append('Subscription bridge fields replace developer API fields without exposing credentials')
                window.evaluate_js("document.getElementById('tab-discord').click()")
                wait_for("!document.getElementById('settings-discord').hidden")
                window.evaluate_js("document.getElementById('settings-close').click()")
                result['checks'].append('Settings dialog and Discord tab work')
                models.worker.close()
                window.evaluate_js("document.getElementById('prompt').value='Create a note';document.getElementById('composer').requestSubmit()")
                wait_for("document.getElementById('approval-dialog').open")
                session = store.sessions()[0]['id']
                project = Path(store.session(session)['workspace'])
                assert project.parent == (store.directory / 'workspaces').resolve()
                assert models.worker.loaded
                result['checks'].append('First message creates a managed chat workspace and auto-loads the selected local model')
                assert not (project / 'note.txt').exists()
                result['checks'].append('File write blocks before approval')
                window.evaluate_js("document.getElementById('approve').click()")
                wait_for("document.getElementById('status').textContent.includes('completed')")
                assert (project / 'note.txt').read_text() == 'Glitch desktop smoke test\n'
                result['checks'].append('Approved write executes through deterministic embedded-worker interface')
                messages = store.messages(session)
                assert any(m['role'] == 'context' for m in messages)
                result['checks'].append('Verified tool evidence persists across turns')
                wait_for("!document.getElementById('send').disabled")
                window.evaluate_js("window.savedConfirm=window.confirm;window.confirm=()=>false;document.getElementById('composer-access').click()")
                time.sleep(.3)
                assert store.settings()['full_access'] is False
                window.evaluate_js("window.confirm=()=>true;document.getElementById('composer-access').click()")
                wait_for("document.getElementById('composer-access').getAttribute('aria-pressed') === 'true' && document.getElementById('access-mode').textContent === 'Full Access'")
                window.evaluate_js("window.confirm=window.savedConfirm;delete window.savedConfirm")
                assert store.settings()['full_access'] is True
                assert window.evaluate_js("document.getElementById('full-access').checked")
                result['checks'].append('Inline Full Access requires confirmation and synchronizes the saved permission and Settings switch')
                previous_approvals = sum(e['kind'] == 'approval' for e in store.events(session, 0))
                (project / 'note.txt').unlink()
                window.evaluate_js("document.getElementById('prompt').value='Create a note again';document.getElementById('composer').requestSubmit()")
                wait_for("document.getElementById('send').disabled")
                wait_for("!document.getElementById('send').disabled")
                assert (project / 'note.txt').exists()
                assert sum(e['kind'] == 'approval' for e in store.events(session, 0)) == previous_approvals
                assert not window.evaluate_js("document.getElementById('approval-dialog').open")
                result['checks'].append('Full Access saves, stays visible and runs a second task without an approval popup')
                wait_for("!document.getElementById('send').disabled")
                window.evaluate_js("document.getElementById('composer-access').click()")
                wait_for("document.getElementById('composer-access').getAttribute('aria-pressed') === 'false'")
                assert store.settings()['full_access'] is False
                result['checks'].append('Inline access control restores approval gates without opening Settings')
                window.evaluate_js("document.getElementById('settings-open').click();document.getElementById('tab-voice').click()")
                wait_for("!document.getElementById('settings-voice').hidden")
                assert not window.evaluate_js("document.getElementById('wake-word-enabled').checked || document.getElementById('announce-completed').checked")
                window.evaluate_js("document.getElementById('settings-close').click()")
                # Synthetic snapshots verify rendering without opening a microphone.
                window.evaluate_js("document.getElementById('prompt').value='Typed first'; updateVoice({input:{phase:'dictating',conversation_id:state.session,generation_id:'fixture-voice',final:'hello',interim:'world',model:{}},output:{phase:'off',voices:[]}})")
                assert window.evaluate_js("!document.getElementById('dictation-preview').hidden && document.getElementById('dictation-text').textContent==='world' && document.getElementById('prompt').value==='Typed first hello'")
                window.evaluate_js("updateVoice({input:{phase:'off',conversation_id:state.session,generation_id:'fixture-voice',final:'hello world',interim:'',model:{}},output:{phase:'off',voices:[]}})")
                assert window.evaluate_js("document.getElementById('dictation-preview').hidden && document.getElementById('prompt').value==='Typed first hello world'")
                assert not engine.state()['running_session']
                window.evaluate_js("document.getElementById('prompt').value='Keep me';updateVoice({input:{phase:'dictating',conversation_id:state.session,generation_id:'cancel-voice',final:'discard',interim:'',model:{}},output:{phase:'off',voices:[]}});restoreDictation()")
                assert window.evaluate_js("document.getElementById('prompt').value==='Keep me'")
                window.evaluate_js("state.voicePhase='off';updateRuntime({running_session:null,approval:null,runs:[{id:'a',session:state.session,role:'Researcher',status:'completed',task:'Check files'}],active_sessions:[],capacity:4})")
                assert window.evaluate_js("document.querySelectorAll('.agent-run').length===1 && document.getElementById('stream-count').textContent==='0 / 4'")
                result['checks'].append('Voice preview streams partial text, preserves typed draft, finalizes without Send, and Cancel restores the draft')
                result['checks'].append('Voice opt-ins default off and independent agent cards render')
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
