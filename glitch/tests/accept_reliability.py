"""Opt-in real Muse/authorized bridge and isolated Chrome acceptance.

Run as a module with --model and --output. Never opens the production Store.
All inference decisions are actual GGUF outputs, not scripted/fake decisions.
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import psutil
import requests

from glitch.computer import ComputerTools
from glitch.engine import AgentEngine
from glitch.models import ModelClient
from glitch.shared_runtime import SharedModelRuntime
from glitch.storage import Store, DEFAULTS
from glitch.tools import WorkspaceTools


def save(output, name, data):
    (output / name).write_text(json.dumps(data, indent=2), encoding='utf-8')


def preflight():
    running = []
    for process in psutil.process_iter(['name', 'pid']):
        if (process.info['name'] or '').lower() in ('glitch.exe', 'llama-server.exe', 'llama-server'):
            running.append(process.info)
    if running:
        raise RuntimeError(f'Refusing model load while existing user runtimes are running: {running}')
    return {'existing_runtimes': running}


class RecordingModels(ModelClient):
    def __init__(self, store, runtime, evidence):
        super().__init__(store, worker=runtime)
        self.evidence = evidence

    def chat(self, settings, messages, cancel):
        # Capture only the disposable synthetic conversation, before real inference.
        self.evidence['prompts'].append(messages)
        decision = super().chat(settings, messages, cancel)
        self.evidence['decisions'].append(decision)
        return decision

    def review(self, settings, task, actions, reason, cancel):
        directive = super().review(settings, task, actions, reason, cancel)
        self.evidence['reviews'].append({'reason': reason, 'actions': actions, 'directive': directive,
                                        'next_prompt_index': len(self.evidence['prompts'])})
        return directive


def model_acceptance(output, model, bridge, selected_model, temperature_probe=False):
    evidence = {'passed': False, 'prompts': [], 'decisions': [], 'reviews': []}
    runtime = SharedModelRuntime()
    engine = None
    timer = None
    with tempfile.TemporaryDirectory(prefix='glitch-reliability-') as folder:
        root = Path(folder)
        workspace = root / 'workspace'
        workspace.mkdir()
        store = Store(root / 'store')
        session = store.new_session(str(workspace))
        archive = 'Synthetic archived exchange: preserve this exact original row.'
        store.message(session, 'user', archive)
        store.message(session, 'assistant', 'Acknowledged synthetic archive.')
        before = store.messages(session)
        settings = store.save_settings({'mode': 'hybrid', 'worker_model': model.name,
            'context_length': 65535, 'parallel_streams': 1, 'gpu_mode': 'cuda', 'cpu_threads': 8,
            'temperature': 0.15, 'max_steps': 8, 'audit_interval': 5,
            'supervisor_auth': 'proxy', 'proxy_url': bridge, 'proxy_model': selected_model})
        client = RecordingModels(store, runtime, evidence)
        original_write = WorkspaceTools.write
        injected = False

        def failed_once(tools, args):
            nonlocal injected
            if not injected:
                injected = True
                return {'ok': False, 'error': 'Synthetic fixture failure: wiki.html was NOT written and is missing. Retry the explicit relative path wiki.html, then verify readback.'}
            return original_write(tools, args)

        try:
            evidence['preflight'] = preflight()
            gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                                 capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            gpu.check_returncode()
            evidence['gpu'] = gpu.stdout.strip()
            evidence['connection'] = client.supervisor.test(settings)
            if not evidence['connection']['generation_ok']:
                raise RuntimeError(evidence['connection']['message'])
            # Opt-in only: do not repeat a known failing live parameter probe.
            if temperature_probe:
                with requests.post(bridge + '/chat/completions', json={'model': selected_model,
                        'temperature': 0.1, 'max_tokens': 600,
                        'messages': [{'role': 'user', 'content': 'Synthetic compatibility probe: reply OK.'}]},
                        timeout=(5, 60), allow_redirects=False) as response:
                    evidence['controlled_temperature_probe'] = {'http_status': response.status_code,
                        'expected_failure': not response.ok, 'model': selected_model}
            # Recheck immediately before load, never kill or reuse user processes.
            evidence['preload'] = preflight()
            cancel = threading.Event()
            timer = threading.Timer(300, cancel.set)
            timer.start()
            runtime.load(model, settings, cancel)
            timer.cancel()
            timer.join()
            evidence['runtime'] = runtime.status()
            evidence['allocation'] = runtime.slots()
            assert evidence['runtime']['backend'] == 'cuda'
            assert runtime.budget.total == 65535
            assert len(evidence['allocation']) == 1
            client.library.path = lambda name: model if name == model.name else None
            engine = AgentEngine(store, client)
            prompt = ('Create wiki.html in the selected workspace containing exactly '
                      '<h1>Reliability fixture</h1>. Use write_file with relative path wiki.html. '
                      'Use actual tool results, retry a harmless failed write only if permitted, '
                      'and do not claim creation until verified. Do not delegate or use computer tools.')
            with patch.object(WorkspaceTools, 'write', failed_once):
                engine.start(session, prompt)
                deadline = time.monotonic() + 480
                while engine.thread.is_alive() and time.monotonic() < deadline:
                    approval = engine.state()['approval']
                    if approval:
                        allowed = approval['action'] == 'Write file' and approval['payload'].get('path') == 'wiki.html'
                        engine.resolve_approval(approval['id'], allowed)
                        evidence.setdefault('approvals', []).append({'action': approval['action'], 'approved': allowed})
                    engine.thread.join(.1)
                if engine.thread.is_alive():
                    engine.stop()
                    engine.thread.join(5)
                    if engine.thread.is_alive():
                        runtime.close()
                        engine.thread.join(10)
                    raise TimeoutError('Actual Muse task exceeded the 480-second acceptance deadline.')
            evidence['injected_failed_write'] = injected
            events = store.events(session, 0)
            evidence['events'] = events
            evidence['anchors'] = Store(root / 'store').anchors(session)
            evidence['archive_preserved'] = store.messages(session)[:len(before)] == before
            injections = []
            for review in evidence['reviews']:
                index = review['next_prompt_index']
                injected_anchors = []
                if index < len(evidence['prompts']):
                    system = evidence['prompts'][index][0]['content']
                    # The production protocol serializes anchors as JSON; raw
                    # substring matching wrongly rejects quotes and newlines.
                    injected_anchors = json.loads(system.rsplit('\nPersistent course corrections:\n', 1)[1])
                injections.append({'next_prompt_index': index,
                                   'directive_present': review['directive'] in injected_anchors})
            evidence['correction_injections'] = injections
            evidence['next_prompt_injection'] = bool(injections) and all(i['directive_present'] for i in injections)
            assert injected, 'Muse never attempted a write; no synthetic tool failure was injected.'
            assert evidence['reviews'], 'No live supervisor correction was received.'
            assert evidence['reviews'][0]['directive'] in evidence['anchors'], 'Correction was not persisted.'
            assert evidence['next_prompt_injection'], 'Live directive was not in the next local system prompt.'
            assert evidence['archive_preserved'], 'Synthetic original archive changed.'
            assert any(event['kind'] == 'correction' for event in events), 'No correction event.'
            assert any(event['kind'] == 'completed' for event in events), 'Muse did not reach verified completion.'
            proofs = [event['payload']['result'] for event in events
                      if event['kind'] == 'result' and event['title'] == 'read_file']
            artifact = workspace / 'wiki.html'
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            assert proofs[-1]['sha256'] == digest
            assert proofs[-1]['absolute_path'] == str(artifact)
            evidence['artifact'] = {'path_at_verification': str(artifact), 'sha256': digest,
                                    'content': artifact.read_text(encoding='utf-8'), 'workspace_disposable': True}
            assert evidence['artifact']['content'] == '<h1>Reliability fixture</h1>'
            evidence['passed'] = True
        except Exception as error:
            evidence['error'] = type(error).__name__ + ': ' + str(error)
        finally:
            if timer:
                timer.cancel()
                timer.join()
            if engine and engine.thread and engine.thread.is_alive():
                engine.stop()
            evidence['runtime_log'] = list(runtime.logs)
            runtime.close()
            if engine and engine.thread:
                engine.thread.join(10)
                evidence['task_thread_stopped'] = not engine.thread.is_alive()
            evidence['runtime_closed'] = runtime.process is None
            evidence['events'] = store.events(session, 0)
            evidence['anchors'] = store.anchors(session)
            evidence['injected_failed_write'] = injected
            save(output, 'model-acceptance.json', evidence)
    return evidence


def chrome_acceptance(output):
    evidence = {'passed': False, 'actions': [], 'desktop_input_tested': False}
    process = None
    server = None
    worker = None
    children = []
    with tempfile.TemporaryDirectory(prefix='glitch-chrome-') as folder:
        try:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 9222))
            candidates = [Path(os.environ.get(name, '')) / 'Google/Chrome/Application/chrome.exe'
                          for name in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA')]
            chrome = next(p for p in candidates if p.is_file())
            profile = Path(folder) / 'chrome-profile'
            argv = [str(chrome), '--headless=new', '--remote-debugging-address=127.0.0.1',
                    '--remote-debugging-port=9222', f'--user-data-dir={profile}',
                    '--no-first-run', '--no-default-browser-check', 'about:blank']
            process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
            fixture = b'''<!doctype html><title>Glitch isolated fixture</title>
                <h1>Reliability fixture</h1><input id="name"><button id="apply"
                onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Apply</button>
                <p id="result">Pending</p>'''

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def do_GET(self):
                    ui = Path(__file__).resolve().parents[1] / 'ui'
                    routes = {'/ui/': ui / 'index.html', '/ui/app.js': ui / 'app.js', '/ui/style.css': ui / 'style.css'}
                    path = routes.get(self.path)
                    body = path.read_bytes() if path and path.is_file() else fixture
                    self.send_response(200)
                    kind = 'text/javascript' if self.path.endswith('.js') else 'text/css' if self.path.endswith('.css') else 'text/html'
                    self.send_header('Content-Type', kind + '; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            approvals = []
            def approve(action, args):
                approvals.append({'action': action, 'args': args})
                return action == 'Browser Action'
            tools = ComputerTools(folder, approve, lambda *_: None, threading.Event())
            url = f'http://127.0.0.1:{server.server_port}/'
            def action(args):
                result = tools.execute('browser_action', args)
                result.pop('_image', None)
                evidence['actions'].append({'args': args, 'result': result})
                assert result['ok'], result
                return result
            tabs = action({'action': 'tabs'})['tabs']
            assert all(t['url'] == 'about:blank' for t in tabs), 'Unexpected preexisting page; refusing interaction.'
            tab_id = tabs[0]['id']
            action({'action': 'open', 'url': url, 'tab_id': tab_id})
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                result = action({'action': 'text', 'tab_id': tab_id})
                if 'Reliability fixture' in result.get('value', ''):
                    break
                time.sleep(.1)
            assert 'Reliability fixture' in result['value']
            action({'action': 'fill', 'selector': '#name', 'text': 'Native CDP verified', 'tab_id': tab_id})
            action({'action': 'click', 'selector': '#apply', 'tab_id': tab_id})
            assert 'Native CDP verified' in action({'action': 'text', 'tab_id': tab_id})['value']
            screenshot = tools.execute('browser_action', {'action': 'screenshot', 'tab_id': tab_id})
            image = base64.b64decode(screenshot['_image'])
            assert image.startswith(b'\x89PNG\r\n\x1a\n')
            from PIL import Image
            capture = Image.open(screenshot['capture']).convert('RGB')
            assert len(capture.getcolors(capture.width * capture.height) or []) > 10, 'Blank screenshot.'
            (output / 'chrome-fixture.png').write_bytes(image)
            evidence['screenshot'] = {'path': str(output / 'chrome-fixture.png'),
                                      'sha256': hashlib.sha256(image).hexdigest(), 'size': capture.size}
            evidence['approvals'] = approvals
            # Render the real bundled UI; only the native API boundary is a
            # synthetic fixture here. Live bridge generation is tested separately.
            import websocket
            pages = tools.chrome.ensure()
            page = next(p for p in pages if p['id'] == tab_id)
            connection = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10,
                                                       suppress_origin=True, http_proxy_host=None)
            counter = 0
            def evaluate(expression):
                nonlocal counter
                counter += 1
                connection.send(json.dumps({'id': counter, 'method': 'Runtime.evaluate',
                    'params': {'expression': expression, 'returnByValue': True, 'awaitPromise': True}}))
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    response = json.loads(connection.recv())
                    if response.get('id') == counter:
                        assert not response.get('error'), response
                        result = response.get('result', {})
                        assert not result.get('exceptionDetails'), result
                        return result.get('result', {}).get('value')
                raise TimeoutError('Own-profile UI evaluation timed out.')
            try:
                action({'action': 'open', 'url': url + 'ui/', 'tab_id': tab_id})
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if evaluate("typeof state!=='undefined' && !!document.getElementById('test-supervisor').onclick"):
                        break
                    time.sleep(.1)
                settings = DEFAULTS | {'supervisor_auth': 'proxy', 'proxy_model': 'selected-fixture-model'}
                evaluate('state.ready=true;state.initialized=true;state.settings=' + json.dumps(settings) + ';'
                         'window.pywebview={api:{save_settings:async values=>({...state.settings,...values}),'
                         'test_supervisor:async()=>window.fixtureConnection}};initializationGate();populateSettings();'
                         "document.getElementById('settings-dialog').showModal();document.getElementById('tab-supervisor').click();")
                failure = {'ok': False, 'catalog_ok': True, 'generation_ok': False, 'models': ['unrelated-model'],
                           'message': 'Selected model selected-fixture-model: generation failed HTTP 500; catalog verified.'}
                evaluate('window.fixtureConnection=' + json.dumps(failure) + ";document.getElementById('test-supervisor').click();")
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and evaluate("document.getElementById('test-supervisor').disabled"):
                    time.sleep(.1)
                state_failure = evaluate("({message:document.getElementById('supervisor-result').textContent,status:document.getElementById('status').textContent,model:document.getElementById('proxy-model').value})")
                assert state_failure['message'] == failure['message']
                assert state_failure['status'] == failure['message']
                assert state_failure['model'] == 'selected-fixture-model'
                success = failure | {'ok': True, 'generation_ok': True,
                    'message': 'Selected model selected-fixture-model: real generation verified. Catalog verified.'}
                evaluate('window.fixtureConnection=' + json.dumps(success) + ";document.getElementById('test-supervisor').click();")
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and evaluate("document.getElementById('test-supervisor').disabled"):
                    time.sleep(.1)
                state_success = evaluate("({message:document.getElementById('supervisor-result').textContent,status:document.getElementById('status').textContent,model:document.getElementById('proxy-model').value})")
                assert state_success['message'] == success['message']
                assert state_success['status'] != failure['message'], 'Successful generation leaves stale failure status.'
                assert state_success['model'] == 'selected-fixture-model'
                evidence['ui_fixture'] = {'failure': state_failure, 'success': state_success,
                                          'api_results_synthetic': True, 'production_app_js': True}
                ui_capture = tools.execute('browser_action', {'action': 'screenshot', 'tab_id': tab_id})
                (output / 'supervisor-ui.png').write_bytes(base64.b64decode(ui_capture['_image']))
            finally:
                connection.close()
            evidence['passed'] = True
        except Exception as error:
            evidence['error'] = type(error).__name__ + ': ' + str(error)
        finally:
            if server:
                server.shutdown()
                server.server_close()
            if worker:
                worker.join(5)
            if process:
                try:
                    children = psutil.Process(process.pid).children(recursive=True)
                except psutil.NoSuchProcess:
                    pass
                for child in children:
                    try:
                        child.terminate()
                    except psutil.NoSuchProcess:
                        pass
                if process.poll() is None:
                    process.terminate()
                    process.wait(5)
                _, alive = psutil.wait_procs(children, timeout=5)
                for child in alive:
                    try:
                        child.kill()
                    except psutil.NoSuchProcess:
                        pass
                psutil.wait_procs(alive, timeout=5)
                evidence['owned_browser_closed'] = process.poll() is not None and all(not p.is_running() for p in children)
            save(output, 'chrome-acceptance.json', evidence)
    return evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bridge', default='http://127.0.0.1:10531/v1')
    parser.add_argument('--supervisor-model', default='gpt-6.1-sol')
    parser.add_argument('--temperature-probe', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    chrome = chrome_acceptance(args.output.resolve())
    model = model_acceptance(args.output.resolve(), args.model.resolve(strict=True), args.bridge,
                             args.supervisor_model, args.temperature_probe)
    summary = {'chrome_passed': chrome['passed'], 'model_passed': model['passed'],
               'chrome_error': chrome.get('error'), 'model_error': model.get('error')}
    save(args.output, 'summary.json', summary)
    print(json.dumps(summary))
    return 0 if all((chrome['passed'], model['passed'])) else 1


if __name__ == '__main__':
    raise SystemExit(main())
