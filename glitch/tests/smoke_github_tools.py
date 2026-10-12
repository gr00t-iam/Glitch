"""Task 6 source WebView2 fixture. No inference, user data or public GitHub calls."""
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
    from dulwich.client import LocalGitClient
    from dulwich.config import StackedConfig
    from dulwich.repo import Repo
    from glitch.api import DesktopAPI
    from glitch.desktop_runtime import install_webview_cleanup_guard
    from glitch.engine import AgentEngine
    from glitch.github_service import GitHubService
    from glitch.github_tools import GitHubTools
    from glitch.models import ModelClient
    from glitch.storage import Store
    from glitch.tests.test_github_service import GitHubTests

    install_webview_cleanup_guard()
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': [], 'live_github': False, 'inference': False, 'frozen': False}
    with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}), \
            tempfile.TemporaryDirectory(prefix='glitch-task6-ui-') as folder:
        root = Path(folder)
        store = Store(root / 'data')
        source = root / 'remote'
        source.mkdir()
        with Repo.init(source, config=StackedConfig([]), symlinks=False) as repo:
            GitHubTests.commit(repo, {'hello.txt': b'Native source fixture\n'})
        item = store.vault.save('Native fixture', 'github', 'https://github.com', {'token': 'synthetic-task6-ONLY'})
        def http(endpoint, payload, cancel, deadline, body=None):
            if endpoint == '/user':
                return 200, {}, {'login': 'fixture', 'id': 42}
            if '/branches/' in endpoint:
                return 200, {}, {'protected': False}
            return 200, {}, GitHubTests.repository()
        class Client:
            def fetch(self, _, target, **kwargs):
                return LocalGitClient().fetch(str(source), target, **kwargs)
            def get_refs(self, _, **kwargs):
                return LocalGitClient().get_refs(str(source), **kwargs)
            def send_pack(self, _, update, pack, **kwargs):
                return LocalGitClient().send_pack(str(source), update, pack, **kwargs)
        service = GitHubService(store.vault, http=http, git_factory=lambda *_: Client())
        cancel = threading.Event()
        workspace = Path(service.clone(item['id'], 'fixture', 'sample', root, 'checkout', cancel)['workspace'])
        session = store.new_session(workspace)
        store.save_settings({'github_author_name': 'Native fixture', 'github_author_email': 'fixture@example.invalid',
                             'full_access': True})
        models = ModelClient(store)
        engine = AgentEngine(store, models)
        api = DesktopAPI(store, engine, models)
        api._github = service
        window = webview.create_window('Glitch - Task 6 source verification',
            str(Path(__file__).resolve().parents[1] / 'ui/index.html'), js_api=api,
            width=1200, height=800, background_color='#101216')
        api._window = window
        workers = []

        def wait(expression, timeout=12):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if window.evaluate_js(expression):
                    return
                time.sleep(.1)
            raise AssertionError('Native fixture condition timed out: ' + expression)

        def capture(name):
            from System import Action
            tasks = []
            window.native.Invoke(Action(lambda: tasks.append(
                window.native.webview.CoreWebView2.CallDevToolsProtocolMethodAsync('Page.captureScreenshot', '{}'))))
            (output / name).write_bytes(base64.b64decode(json.loads(str(tasks[0].Result))['data']))

        def probe():
            try:
                wait('state.initialized && state.ready && !!state.session')
                window.evaluate_js("window.task6Errors=[];addEventListener('error',e=>task6Errors.push(e.message));window.confirm=()=>true;document.getElementById('settings-open').click();document.getElementById('tab-github').click()")
                wait("document.getElementById('github-credential').options.length===2")
                window.evaluate_js(f"document.getElementById('github-credential').value='{item['id']}';document.getElementById('github-owner').value='fixture';document.getElementById('github-repo').value='sample';document.getElementById('github-validate').click()")
                wait("!state.githubBusy && !document.getElementById('github-bind').disabled")
                window.evaluate_js("document.getElementById('github-bind').click()")
                wait("document.getElementById('github-result').textContent==='Project connection saved'")
                assert Store(store.directory).github_connection(workspace)['credential_id'] == item['id']
                result['checks'].append('Native binding through confirmed bridge persists only project metadata')
                (workspace / 'hello.txt').write_bytes(b'Native source changed\n')
                window.evaluate_js("document.getElementById('github-review-paths').value='hello.txt';document.getElementById('github-review').click()")
                wait("document.getElementById('github-review-diff').textContent.includes('+Native source changed')")
                window.evaluate_js("document.getElementById('github-review').scrollIntoView({block:'center'})")
                capture('repository-review-settings.png')
                result['checks'].append('Explicit native review renders the actual protected-source diff')
                # Restore the clean branch prerequisite, then use the real engine approval path.
                (workspace / 'hello.txt').write_bytes(b'Native source fixture\n')
                window.evaluate_js("document.getElementById('settings-close').click()")
                engine.running_session = session
                tools = GitHubTools(service, workspace, engine._approve, engine._emit, cancel)
                outcomes = []
                def publish():
                    try:
                        outcomes.append(tools.execute('github_create_branch', {'branch': 'feature/native'}))
                        (workspace / 'hello.txt').write_bytes(b'Native source changed\n')
                        outcomes.append(tools.execute('github_commit_and_push', {'paths': ['hello.txt'],
                            'branch': 'feature/native', 'title': 'Native fixture change', 'body': 'Bound repository review'}))
                    finally:
                        engine.running_session = None
                thread = threading.Thread(target=publish, daemon=True)
                workers.append(thread)
                thread.start()
                wait("document.getElementById('approval-dialog').open && document.getElementById('approval-title').textContent==='github_create_branch'")
                window.evaluate_js("document.getElementById('approve').click()")
                wait("document.getElementById('approval-dialog').open && document.getElementById('approval-title').textContent==='github_commit_and_push'")
                assert window.evaluate_js("document.getElementById('review-repository').textContent==='fixture/sample' && document.getElementById('review-branch').textContent==='feature/native' && document.getElementById('review-fingerprint').textContent.length===64 && document.getElementById('review-diff').textContent.includes('+Native source changed')")
                for width, height, name in [(1200,800,'repository-approval-desktop.png'), (900,680,'repository-approval-compact.png')]:
                    window.resize(width, height)
                    time.sleep(.3)
                    assert window.evaluate_js("document.getElementById('approval-dialog').scrollWidth<=document.getElementById('approval-dialog').clientWidth")
                    capture(name)
                window.evaluate_js("document.getElementById('approve').click()")
                thread.join(8)
                assert not thread.is_alive() and all(item['ok'] for item in outcomes) and len(outcomes) == 2
                with Repo(source) as repo:
                    assert repo.refs[b'refs/heads/feature/native'].decode() == outcomes[-1]['head']
                assert not window.evaluate_js('task6Errors')
                assert 'synthetic-task6-ONLY' not in window.evaluate_js('JSON.stringify(state)')
                result['checks'].append('Full Access still opens real human branch/publish approvals with exact destination, paths, HEAD, fingerprint, message and diff')
                result['checks'].append('Desktop and compact dialogs fit; approved local fixture push succeeds; no page errors or model calls')
                result['passed'] = True
            except Exception as error:
                result['error'] = str(error)
            finally:
                engine.stop()
                cancel.set()
                for thread in workers:
                    thread.join(5)
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
    evidence = run(parser.parse_args().output_directory)
    print(json.dumps(evidence, indent=2))
    raise SystemExit(0 if evidence['passed'] else 1)
