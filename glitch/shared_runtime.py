"""One private llama.cpp process with independently cancellable shared-weight slots."""
import json
import os
import secrets
import socket
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
import requests
from glitch.runtime_assets import runtime_directory


class SharedModelRuntime:
    def __init__(self):
        self.lock = threading.RLock()
        self.load_lock = threading.Lock()
        self.process = None
        self.key = ''
        self.url = ''
        self.signature = None
        self.active = 0
        self.logs = deque(maxlen=20)
        self.snapshot = {'phase': 'unloaded', 'name': '', 'message': 'No model loaded', 'usage': {}, 'slots': 1, 'occupied': 0}

    def status(self):
        with self.lock:
            result = dict(self.snapshot)
            if self.process and self.process.poll() is not None:
                result.update(phase='error', message='Local model process stopped. Reload the model.')
            result['occupied'] = self.active
            result['pid'] = self.process.pid if self.process else None
            return result

    def _client(self):
        client = requests.Session()
        client.trust_env = False
        client.headers['Authorization'] = 'Bearer ' + self.key
        return client

    def load(self, path, settings, cancel, projector=None):
        signature = (str(Path(path).resolve()), settings['context_length'], settings['cpu_threads'], settings.get('parallel_streams', 1), str(projector))
        while not self.load_lock.acquire(timeout=.1):
            if cancel.is_set():
                raise InterruptedError('Stopped during model loading.')
        try:
            if cancel.is_set():
                raise InterruptedError('Stopped.')
            if self.signature == signature and self.process and self.process.poll() is None:
                return
            with self.lock:
                if self.active:
                    raise ValueError('Stop active streams before changing the loaded model.')
            self.close()
            path = Path(path).resolve(strict=True)
            binary = runtime_directory() / 'llama-server.exe'
            if not binary.is_file():
                raise RuntimeError('The bundled local runtime is missing. Install a complete Glitch release.')
            slots = settings.get('parallel_streams', 1)
            if type(slots) is not int or not 1 <= slots <= 4:
                raise ValueError('Choose one to four streams.')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            self.key = secrets.token_urlsafe(32)
            self.url = f'http://127.0.0.1:{port}'
            environment = {k: v for k, v in os.environ.items() if not k.startswith('LLAMA_') and not any(s in k.upper() for s in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY'))}
            environment['LLAMA_API_KEY'] = self.key
            argv = [str(binary), '-m', str(path), '--host', '127.0.0.1', '--port', str(port),
                    '--parallel', str(slots), '--ctx-size', str(settings['context_length'] * slots), '--no-kv-unified',
                    '--threads', str(settings['cpu_threads']), '--n-gpu-layers', '0', '--no-webui', '--no-ui-mcp-proxy', '--no-jinja', '--slots']
            if projector:
                argv += ['--mmproj', str(Path(projector).resolve(strict=True))]
            with self.lock:
                self.snapshot.update(phase='loading', name=path.name, message='Loading one shared local model...', slots=slots,
                                     context_per_agent=settings['context_length'], total_context=settings['context_length'] * slots)
                self.temperature = settings['temperature']
                self.logs.clear()
                self.process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                env=environment, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                process = self.process
            def drain():
                for line in iter(process.stdout.readline, b''):
                    self.logs.append(line.decode('utf-8', errors='replace').strip())
                process.stdout.close()
            threading.Thread(target=drain, daemon=True).start()
            deadline = time.monotonic() + 300
            with self._client() as client:
                while time.monotonic() < deadline:
                    if cancel.is_set():
                        raise InterruptedError('Stopped while loading the model.')
                    if process.poll() is not None:
                        raise RuntimeError('Model could not load (model compatibility or available RAM). ' + ' '.join(self.logs)[-1500:])
                    try:
                        with client.get(self.url + '/v1/models', timeout=1, allow_redirects=False) as response:
                            if response.status_code == 200:
                                allocation = self.slots()
                                if len(allocation) != slots or any(slot.get('n_ctx') != settings['context_length'] for slot in allocation):
                                    raise RuntimeError('This model/runtime reduced the requested context. Choose a context supported by the model; no silent reduction is allowed.')
                                self.signature = signature
                                with self.lock:
                                    self.snapshot.update(phase='ready', message=f'Ready - {slots} shared-model stream(s)')
                                return
                    except requests.RequestException:
                        pass
                    cancel.wait(.2)
            raise RuntimeError('Local model load timed out. Try a smaller context or model.')
        except Exception as error:
            self.close()
            with self.lock:
                self.snapshot.update(phase='error', message=str(error))
            raise
        finally:
            self.load_lock.release()

    def slots(self):
        with self._client() as client:
            with client.get(self.url + '/slots', timeout=2, allow_redirects=False) as response:
                response.raise_for_status()
                return response.json()

    def chat(self, messages, schema, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        with self.lock:
            if not self.process or self.process.poll() is not None:
                raise RuntimeError('Load a local model first.')
            if self.active >= self.snapshot['slots']:
                raise ValueError('All local streams are busy.')
            self.active += 1
            self.snapshot.update(phase='generating', message='Processing locally with shared weights...')
        try:
            # llama.cpp uses OpenAI multimodal messages rather than Ollama images fields.
            converted = []
            for message in messages:
                item = {'role': message['role'], 'content': message['content']}
                if message.get('images'):
                    item['content'] = [{'type': 'text', 'text': message['content']}] + [
                        {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image}} for image in message['images']]
                converted.append(item)
            payload = {'messages': converted, 'temperature': self.temperature, 'max_tokens': 1536,
                       'stream': True, 'response_format': {'type': 'json_object', 'schema': schema}}
            pieces = []
            finished = threading.Event()
            with self._client() as client:
                with client.post(self.url + '/v1/chat/completions', json=payload, stream=True,
                                 timeout=(5, 120), allow_redirects=False) as response:
                    if response.status_code != 200:
                        raise RuntimeError('Local generation failed: ' + response.text[:1000])
                    def watch():
                        while not finished.wait(.05):
                            if cancel.is_set():
                                try:
                                    response.raw._fp.fp.raw._sock.shutdown(socket.SHUT_RDWR)
                                except (AttributeError, OSError):
                                    pass
                                return
                    watcher = threading.Thread(target=watch, daemon=True)
                    watcher.start()
                    reason = None
                    try:
                        for line in response.iter_lines(chunk_size=1):
                            if cancel.is_set():
                                raise InterruptedError('Stopped.')
                            if not line.startswith(b'data: '):
                                continue
                            if line == b'data: [DONE]':
                                break
                            event = json.loads(line[6:])
                            if event.get('error'):
                                raise RuntimeError(str(event['error']))
                            for choice in event.get('choices', []):
                                pieces.append(choice.get('delta', {}).get('content') or '')
                                reason = choice.get('finish_reason') or reason
                            if sum(map(len, pieces)) > 200000:
                                raise ValueError('Local response exceeded the safe size limit.')
                    finally:
                        finished.set()
                        watcher.join(timeout=1)
            if cancel.is_set():
                raise InterruptedError('Stopped.')
            if reason != 'stop':
                raise ValueError('Local response did not finish within its output budget. No tool was executed.')
            return json.loads(''.join(pieces))
        except Exception:
            if cancel.is_set():
                raise InterruptedError('Stopped.') from None
            raise
        finally:
            with self.lock:
                self.active -= 1
                self.snapshot.update(phase='generating' if self.active else 'ready', message='Processing locally...' if self.active else 'Shared local model ready')

    def close(self):
        with self.lock:
            process, self.process = self.process, None
            self.signature = None
            self.snapshot.update(phase='unloaded', name='', message='No model loaded')
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
