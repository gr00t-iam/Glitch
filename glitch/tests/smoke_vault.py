"""Real WebView2 vault settings verification; only temporary synthetic user data."""
import argparse
import base64
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch


def run(output_directory):
    import webview
    from glitch.api import DesktopAPI
    from glitch.desktop_runtime import install_webview_cleanup_guard
    from glitch.engine import AgentEngine
    from glitch.models import ModelClient
    from glitch.storage import Store

    install_webview_cleanup_guard()
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    # Retain Windows system variables needed by Winsock/WebView2, never credential overrides.
    with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}), tempfile.TemporaryDirectory(prefix='glitch-vault-smoke-') as folder:
        store = Store(Path(folder) / 'data')
        models = ModelClient(store)
        engine = AgentEngine(store, models)
        api = DesktopAPI(store, engine, models)
        window = webview.create_window('Glitch - Vault verification',
            str(Path(__file__).resolve().parents[1] / 'ui' / 'index.html'),
            js_api=api, width=1200, height=800, background_color='#101216')
        api._window = window

        def wait_for(expression, timeout=12):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if window.evaluate_js(expression):
                    return
                time.sleep(.1)
            raise AssertionError('Native condition timed out: ' + expression)

        def capture(name):
            from System import Action
            calls = []
            window.native.Invoke(Action(lambda: calls.append(
                window.native.webview.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', '{}'))))
            data = json.loads(str(calls[0].Result))
            (output / name).write_bytes(base64.b64decode(data['data']))

        def probe():
            try:
                wait_for("state.ready && document.getElementById('settings-open')")
                window.evaluate_js("document.getElementById('settings-open').click()")
                wait_for("document.getElementById('settings-dialog').open")
                assert window.evaluate_js("!!document.getElementById('tab-vault')"), 'Vault settings tab missing'
                window.evaluate_js("document.getElementById('tab-vault').click()")
                wait_for("!document.getElementById('settings-vault').hidden")
                wait_for("document.getElementById('vault-list').textContent.includes('No saved credentials')")
                assert window.evaluate_js("document.getElementById('vault-secret').type==='password' && document.getElementById('vault-username').type==='password'")
                result['checks'].append('Masked Vault settings tab renders with an empty state')
                window.evaluate_js("document.getElementById('vault-name').value='Native fixture';document.getElementById('vault-origin').value='https://example.invalid';document.getElementById('vault-secret').value='synthetic-native-vault-ONLY';document.getElementById('vault-save').click()")
                wait_for("document.getElementById('vault-result').textContent==='Saved securely'")
                assert window.evaluate_js("document.getElementById('vault-secret').value==='' && document.getElementById('vault-list').textContent.includes('Saved')")
                assert 'synthetic-native-vault-ONLY' not in window.evaluate_js("JSON.stringify(state.vault)")
                item = store.vault.list()[0]
                assert store.vault.resolve(item['id'], 'https://example.invalid')['token'] == 'synthetic-native-vault-ONLY'
                result['checks'].append('Add persists with production DPAPI, returns metadata only, clears entry fields and shows Saved')
                window.evaluate_js("document.querySelector('[data-vault-edit]').click()")
                assert window.evaluate_js("document.getElementById('vault-secret').value==='' && document.getElementById('vault-save').textContent==='Update credential'")
                window.evaluate_js("document.getElementById('vault-save').click()")
                wait_for("document.getElementById('vault-result').textContent.includes('replacement')")
                assert store.vault.resolve(item['id'], 'https://example.invalid')['token'] == 'synthetic-native-vault-ONLY'
                window.evaluate_js("document.getElementById('vault-secret').value='synthetic-native-replacement-ONLY';document.getElementById('vault-save').click()")
                wait_for("document.getElementById('vault-result').textContent==='Updated securely'")
                assert store.vault.resolve(item['id'], 'https://example.invalid')['token'] == 'synthetic-native-replacement-ONLY'
                result['checks'].append('Update never retrieves stored values, requires replacement and preserves the credential ID')
                # Synthetic runtime snapshot exercises the shared UI gate, without inference.
                window.evaluate_js("updateRuntime({running_session:'fixture-run',active_sessions:['fixture-run'],approval:null,capacity:1,runs:[]})")
                assert window.evaluate_js("document.getElementById('vault-save').matches(':disabled') && document.querySelector('[data-vault-delete]').disabled && document.getElementById('vault-fields').disabled"), 'Active stream did not disable mutations'
                window.evaluate_js("updateRuntime({running_session:null,active_sessions:[],approval:null,capacity:1,runs:[]})")
                assert window.evaluate_js("!document.getElementById('vault-save').disabled")
                result['checks'].append('Any active stream disables credential fields and mutations; idle restores them')
                window.evaluate_js("window.savedConfirm=window.confirm;window.confirm=()=>false;document.querySelector('[data-vault-delete]').click()")
                time.sleep(.3)
                assert len(store.vault.list()) == 1
                window.evaluate_js("window.confirm=()=>true;document.querySelector('[data-vault-delete]').click()")
                wait_for("document.getElementById('vault-result').textContent==='Credential deleted'")
                assert not store.vault.list()
                window.evaluate_js("window.confirm=window.savedConfirm;delete window.savedConfirm")
                result['checks'].append('Delete requires confirmation and updates the empty state')
                window.evaluate_js("document.getElementById('vault-kind').value='proxmox';document.getElementById('vault-kind').dispatchEvent(new Event('change'))")
                assert window.evaluate_js("!document.getElementById('vault-username-row').hidden && document.getElementById('vault-username-label').textContent==='Token identifier' && document.getElementById('vault-username').value===''")
                window.evaluate_js("document.getElementById('vault-name').value='Proxmox fixture';document.getElementById('vault-origin').value='https://pve.example.invalid:8006';document.getElementById('vault-username').value='fixture@pve!agent';document.getElementById('vault-secret').value='synthetic-proxmox-native-ONLY';document.getElementById('vault-save').click()")
                wait_for("document.getElementById('vault-result').textContent==='Saved securely'")
                assert store.vault.list()[0]['kind'] == 'proxmox'
                layout = window.evaluate_js("(()=>{const s=document.getElementById('settings-dialog');return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:s.scrollWidth>s.clientWidth,content:document.getElementById('settings-vault').textContent,inputs:Array.from(document.querySelectorAll('#vault-fields input')).map(i=>i.value)}})()")
                assert not layout['overflow'] and not layout['dialogOverflow'], layout
                assert 'synthetic-proxmox-native-ONLY' not in layout['content']
                capture('vault-desktop.png')
                window.resize(900, 680)
                time.sleep(.5)
                assert window.evaluate_js("document.getElementById('settings-dialog').scrollWidth<=document.getElementById('settings-dialog').clientWidth")
                capture('vault-compact.png')
                result['checks'].append('Proxmox fields and HTTPS port scope work; desktop and compact native layouts have no horizontal clipping')
                window.evaluate_js("document.getElementById('vault-secret').value='synthetic-unsaved-ONLY';document.getElementById('vault-username').value='synthetic-unsaved-user-ONLY';document.getElementById('settings-close').click()")
                assert window.evaluate_js("document.getElementById('vault-secret').value==='' && document.getElementById('vault-username').value==='' && document.getElementById('vault-ca').value===''")
                result['checks'].append('Closing Settings clears unsaved protected fields')
                result['passed'] = True
            except Exception as error:
                result['error'] = str(error)
            finally:
                models.close()
                (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
                window.destroy()

        once = threading.Event()
        def loaded():
            if not once.is_set():
                once.set()
                threading.Thread(target=probe, daemon=True).start()
        window.events.loaded += loaded
        webview.start(gui='edgechromium', private_mode=True, debug=False)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output_directory')
    args = parser.parse_args()
    evidence = run(args.output_directory)
    print(json.dumps(evidence, indent=2))
    raise SystemExit(0 if evidence['passed'] else 1)
