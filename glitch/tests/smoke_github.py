"""Source WebView2 GitHub settings acceptance, disposable DPAPI Store and local Git."""
import argparse
import base64
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch


def run(output_directory, validation_only=False):
    import webview
    from dulwich.client import LocalGitClient
    from dulwich.config import StackedConfig
    from dulwich.repo import Repo
    from glitch.api import DesktopAPI
    from glitch.desktop_runtime import install_webview_cleanup_guard
    from glitch.engine import AgentEngine
    from glitch.github_service import GitHubService
    from glitch.models import ModelClient
    from glitch.storage import Store
    from glitch.tests.test_github_service import GitHubTests

    install_webview_cleanup_guard()
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': [], 'live_github': False, 'inference': False}
    with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}), \
            tempfile.TemporaryDirectory(prefix='glitch-github-native-') as folder:
        root = Path(folder)
        store = Store(root / 'data')
        source = root / 'source'
        source.mkdir()
        with Repo.init(source, config=StackedConfig([]), symlinks=False) as repo:
            GitHubTests.commit(repo, {'hello.txt': b'Native GitHub fixture\n'})
        models = ModelClient(store)
        engine = AgentEngine(store, models)
        api = DesktopAPI(store, engine, models)
        phase = {'denied': True, 'slow': False}
        def http(endpoint, payload, cancel, deadline):
            if phase['slow']:
                while not cancel.wait(.05):
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                raise InterruptedError('Synthetic GitHub operation cancelled.')
            if phase['denied']:
                return 401, {}, {'message': 'synthetic-native-github-ONLY'}
            if endpoint.startswith('/user/repos'):
                return 200, {}, [GitHubTests.repository()]
            if endpoint == '/user':
                return 200, {}, {'login': 'fixture', 'id': 42}
            return 200, {}, GitHubTests.repository()
        class LocalFixture:
            def fetch(self, _path, target, **kwargs):
                return LocalGitClient().fetch(str(source), target, **kwargs)
        api._github = GitHubService(store.vault, http=http, git_factory=lambda *_: LocalFixture())
        window = webview.create_window('Glitch - GitHub verification',
            str(Path(__file__).resolve().parents[1] / 'ui/index.html'), js_api=api,
            width=1200, height=800, background_color='#101216')
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
            tasks = []
            window.native.Invoke(Action(lambda: tasks.append(
                window.native.webview.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', '{}'))))
            (output / name).write_bytes(base64.b64decode(json.loads(str(tasks[0].Result))['data']))

        def probe():
            try:
                wait_for('state.initialized && state.ready')
                window.evaluate_js("window.githubErrors=[];addEventListener('error',e=>githubErrors.push(e.message));document.getElementById('settings-open').click();document.getElementById('tab-github').click()")
                wait_for("!document.getElementById('settings-github').hidden")
                if validation_only:
                    item = store.vault.save('Validation fixture', 'github', 'https://github.com',
                                            {'token': 'synthetic-validation-old-ONLY'})
                    phase['denied'] = False
                    window.evaluate_js('poll=async()=>{}')
                    def validate():
                        window.evaluate_js("document.getElementById('tab-github').click()")
                        wait_for(f"Array.from(document.getElementById('github-credential').options).some(o=>o.value==='{item['id']}')")
                        window.evaluate_js(f"document.getElementById('github-credential').value='{item['id']}';document.getElementById('github-credential').dispatchEvent(new Event('change'));document.getElementById('github-owner').value='fixture';document.getElementById('github-repo').value='sample';document.getElementById('github-folder').value='sample';state.githubParent='C:/synthetic-parent';document.getElementById('github-validate').click()")
                        wait_for("!state.githubBusy && !!state.githubValidated")
                        assert window.evaluate_js("!document.getElementById('github-clone').disabled && document.getElementById('github-account').textContent==='Account: fixture'")
                    def invalidated():
                        return window.evaluate_js("!state.githubValidated && document.getElementById('github-clone').disabled && document.getElementById('github-account').textContent==='Account not validated' && document.getElementById('github-permissions').textContent==='Read, Contents write and Pull requests write are unverified.'")
                    validate()
                    # Force equal descriptor timestamps to exercise explicit in-place invalidation.
                    window.evaluate_js(f"window.validationActualCall=call;window.validationTimestamp=state.vault.find(i=>i.id==='{item['id']}').updated_at;call=async(method,...args)=>{{const result=await validationActualCall(method,...args);if(method==='vault_list')for(const item of result)item.updated_at=validationTimestamp;return result;}}")
                    window.evaluate_js("document.getElementById('tab-vault').click()")
                    wait_for(f"!!document.querySelector('[data-vault-edit=\"{item['id']}\"]')")
                    window.evaluate_js(f"document.querySelector('[data-vault-edit=\"{item['id']}\"]').click();document.getElementById('vault-secret').value='synthetic-validation-new-ONLY';document.getElementById('vault-save').click()")
                    wait_for("!state.vaultBusy && document.getElementById('vault-result').textContent==='Updated securely'")
                    assert store.vault.list()[0]['id'] == item['id']
                    assert store.vault.resolve(item['id'], 'https://github.com')['token'] == 'synthetic-validation-new-ONLY'
                    assert invalidated(), 'Same-ID token replacement retained prior read/account validation or clone eligibility'
                    assert window.evaluate_js(f"state.vault.find(i=>i.id==='{item['id']}').updated_at===validationTimestamp")
                    window.evaluate_js('call=validationActualCall')
                    result['checks'].append('Actual same-ID Vault replacement clears account/read evidence and clone eligibility')
                    validate()
                    window.evaluate_js(f"state.vault.find(i=>i.id==='{item['id']}').updated_at='synthetic-new-version';renderGitHubCredentials()")
                    assert invalidated(), 'Same-ID descriptor version refresh retained prior validation'
                    result['checks'].append('Same-ID descriptor version change also clears validation')
                    validate()
                    window.evaluate_js("document.getElementById('github-credential').value='';document.getElementById('github-credential').dispatchEvent(new Event('change'))")
                    assert invalidated(), 'Credential selection change retained prior validation'
                    result['checks'].append('Changing the selected credential clears validation')
                    validate()
                    window.evaluate_js("state.vault=[];renderGitHubCredentials()")
                    assert invalidated(), 'Deleting selected credential retained prior validation'
                    result['checks'].append('Deleted credential descriptor clears validation')
                    window.evaluate_js("document.getElementById('tab-github').click()")
                    capture('github-validation-invalidated.png')
                    assert not window.evaluate_js('githubErrors'), 'Validation fixture recorded page errors'
                    result['passed'] = True
                    return
                assert window.evaluate_js("document.title==='Glitch' && document.getElementById('github-token').type==='password'")
                window.evaluate_js("document.querySelector('#github-fields details').open=true;document.getElementById('github-name').value='Native GitHub fixture';document.getElementById('github-token').value='synthetic-native-github-ONLY';document.getElementById('github-save-token').click()")
                wait_for("document.getElementById('github-result').textContent==='Token saved securely'")
                assert window.evaluate_js("document.getElementById('github-token').value==='' && document.getElementById('github-credential').selectedOptions[0].textContent.includes('(Saved)')")
                assert 'synthetic-native-github-ONLY' not in window.evaluate_js('JSON.stringify(state)')
                item = store.vault.list()[0]
                assert store.vault.resolve(item['id'], 'https://github.com')['token'] == 'synthetic-native-github-ONLY'
                result['checks'].append('Masked token entry saves through production DPAPI, clears input, selects metadata-only descriptor')
                window.evaluate_js("document.getElementById('github-owner').value='fixture';document.getElementById('github-repo').value='sample';document.getElementById('github-validate').click()")
                wait_for("document.getElementById('github-result').textContent.includes('expired')")
                assert window.evaluate_js("document.getElementById('github-clone').disabled && !state.githubValidated")
                capture('github-denied.png')
                phase['denied'] = False
                window.evaluate_js("document.getElementById('github-load-repos').click()")
                wait_for("document.getElementById('github-repository').options.length===2")
                window.evaluate_js("document.getElementById('github-repository').value='fixture/sample';document.getElementById('github-repository').dispatchEvent(new Event('change'));document.getElementById('github-validate').click()")
                wait_for("document.getElementById('github-account').textContent==='Account: fixture'")
                assert window.evaluate_js("document.getElementById('github-permissions').textContent.includes('remain unverified')")
                result['checks'].append('Expired token feedback blocks clone; repository picker and read validation show account without claiming write permission')
                window.evaluate_js("document.getElementById('github-author-name').value='Native Fixture';document.getElementById('github-author-email').value='fixture@example.invalid';document.getElementById('github-save-author').click()")
                wait_for("document.getElementById('github-result').textContent==='Author identity saved locally'")
                assert Store(store.directory).settings()['github_author_name'] == 'Native Fixture'
                with patch.object(window, 'create_file_dialog', return_value=(str(root),)):
                    window.evaluate_js("document.getElementById('github-directory').click()")
                    wait_for('!!state.githubParent && !state.githubBusy')
                wait_for("!document.getElementById('github-clone').disabled")
                window.evaluate_js("document.getElementById('github-permissions').scrollIntoView({block:'center'})")
                capture('github-desktop.png')
                window.resize(900, 680)
                time.sleep(.5)
                assert window.evaluate_js("document.getElementById('settings-dialog').scrollWidth<=document.getElementById('settings-dialog').clientWidth")
                capture('github-compact.png')
                window.evaluate_js("window.confirm=()=>true;document.getElementById('github-clone').click()")
                wait_for("document.getElementById('github-result').textContent==='Cloned fixture/sample'")
                assert (root / 'sample/hello.txt').read_bytes() == b'Native GitHub fixture\n'
                assert len(store.sessions()) == 1
                result['checks'].append('Author survives Store reopen; native destination selection and confirmed local clone register a project/conversation; desktop and compact layouts fit')
                phase['slow'] = True
                window.evaluate_js("document.getElementById('github-validate').click()")
                wait_for("state.githubBusy && !document.getElementById('github-cancel').disabled")
                window.evaluate_js("document.getElementById('github-cancel').click()")
                wait_for("!state.githubBusy && document.getElementById('github-result').textContent.includes('cancelled')")
                result['checks'].append('Cancel remains responsive while native GitHub operation holds admission; no model or cloud call')
                window.evaluate_js("updateRuntime({running_session:'other-fixture',active_sessions:['other-fixture'],approval:null,capacity:2,runs:[]})")
                assert window.evaluate_js("document.getElementById('github-fields').disabled"), 'Other stream did not disable GitHub controls'
                window.evaluate_js("updateRuntime({running_session:null,active_sessions:[],approval:null,capacity:2,runs:[]});document.getElementById('github-token').value='unsaved-synthetic-ONLY';document.getElementById('settings-close').click()")
                wait_for("document.getElementById('github-token').value===''")
                errors = window.evaluate_js('githubErrors')
                assert not errors, 'Page errors: ' + str(errors)
                result['checks'].append('Other active streams disable connection controls; closing settings clears unsaved tokens; no page errors')
                result['passed'] = True
            except Exception as error:
                result['error'] = str(error)
            finally:
                api.github_cancel()
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
    parser.add_argument('--validation-only', action='store_true')
    args = parser.parse_args()
    evidence = run(args.output_directory, args.validation_only)
    print(json.dumps(evidence, indent=2))
    raise SystemExit(0 if evidence['passed'] else 1)
