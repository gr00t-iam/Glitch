"""Persistent, isolated CPU inference. A native model crash cannot kill the desktop UI."""

import copy
import json
import multiprocessing
import threading
import time


def prepare_messages(messages, vision):
    result = []
    for original in messages:
        message = {key: copy.deepcopy(original[key]) for key in ('role', 'content')}
        if original.get('images'):
            if not vision:
                raise ValueError('This model cannot inspect screenshots. Load a compatible LLaVA 1.5 model and projector, or use browser DOM tools.')
            message['content'] = [{'type': 'text', 'text': message['content']}] + [
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + image}}
                for image in original['images']]
        result.append(message)
    return result


def inference_process(connection, config):
    model = None
    try:
        from llama_cpp import Llama
        handler = None
        if config.get('projector'):
            from llama_cpp.llama_chat_format import Llava15ChatHandler
            handler = Llava15ChatHandler(clip_model_path=config['projector'], verbose=False)
        model = Llama(model_path=config['path'], n_ctx=config['context'], n_threads=config['threads'],
                      n_gpu_layers=0, chat_handler=handler, verbose=False)
        # Older GGUF files without a chat template need an explicit conventional fallback.
        if handler is None and not model.metadata.get('tokenizer.chat_template'):
            model.chat_format = 'chatml'
        connection.send({'ok': True, 'ready': True})
        while True:
            request = connection.recv()
            if request['kind'] == 'close':
                return
            try:
                messages = prepare_messages(request['messages'], bool(handler))
                response = model.create_chat_completion(messages=messages,
                    response_format={'type': 'json_object', 'schema': request['schema']},
                    temperature=config['temperature'], max_tokens=min(1536, config['context'] // 2))
                if response['choices'][0]['finish_reason'] != 'stop':
                    raise ValueError('The response exceeded the output limit. No action was executed; use a larger context or a smaller task.')
                content = response['choices'][0]['message']['content']
                decision = json.loads(content)
                connection.send({'ok': True, 'decision': decision, 'usage': response.get('usage', {})})
            except Exception as error:
                connection.send({'ok': False, 'error': str(error)[:1500]})
    except (EOFError, BrokenPipeError):
        pass
    except Exception as error:
        try:
            connection.send({'ok': False, 'error': str(error)[:1500]})
        except (EOFError, BrokenPipeError, OSError):
            pass
    finally:
        if model is not None:
            model.close()
        connection.close()


class EmbeddedWorker:
    def __init__(self):
        self._lock = threading.RLock()
        self._state_lock = threading.Lock()
        self._process = None
        self._pipe = None
        self._config = None
        self._state = {'phase': 'unloaded', 'name': '', 'message': 'Select and load a GGUF model.', 'usage': {}}

    def _update(self, **values):
        with self._state_lock:
            self._state.update(values)

    def status(self):
        with self._state_lock:
            result = dict(self._state)
        process = self._process
        try:
            stopped = process is not None and not process.is_alive()
        except ValueError:
            # A simultaneous unload may have already closed the Process object.
            with self._state_lock:
                return dict(self._state)
        if result['phase'] == 'ready' and stopped:
            self._update(phase='error', message='The local inference process stopped. Reload the model.')
            return self.status()
        return result

    def _receive(self, cancel, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if cancel.is_set():
                self.close()
                raise InterruptedError('Local inference stopped. Reload the model to continue.')
            if self._pipe.poll(0.1):
                try:
                    response = self._pipe.recv()
                except EOFError as error:
                    self.close()
                    raise RuntimeError('The model process stopped. Check available RAM and reload the model.') from error
                if not response.get('ok'):
                    raise RuntimeError(response.get('error', 'Local model failed.'))
                return response
            if not self._process.is_alive():
                self.close()
                raise RuntimeError('The model process stopped. Check available RAM and GGUF compatibility.')
        self.close()
        raise TimeoutError('Local model timed out. Try a smaller model or task.')

    def load(self, path, settings, cancel, projector=None):
        config = {'path': str(path), 'context': settings['context_length'], 'threads': settings['cpu_threads'],
                  'temperature': settings['temperature'], 'projector': str(projector) if projector else ''}
        with self._lock:
            if self._config == config and self.status()['phase'] == 'ready':
                return
            self.close()
            self._update(phase='loading', name=path.name, message='Loading model into memory...')
            context = multiprocessing.get_context('spawn')
            self._pipe, child = context.Pipe()
            self._process = context.Process(target=inference_process, args=(child, config), daemon=True)
            try:
                self._process.start()
                child.close()
                self._receive(cancel, 300)
                self._config = config
                self._update(phase='ready', name=path.name, message='Ready for local tasks.')
            except Exception as error:
                self.close()
                self._update(phase='error', name=path.name, message=str(error))
                raise

    def chat(self, messages, schema, cancel):
        with self._lock:
            if self.status()['phase'] != 'ready':
                raise ValueError('Load a local GGUF model in Model Manager first.')
            self._update(phase='generating', message='Glitch is processing locally...')
            try:
                self._pipe.send({'kind': 'chat', 'messages': messages, 'schema': schema})
                response = self._receive(cancel, 600)
                self._update(phase='ready', message='Ready for local tasks.', usage=response.get('usage', {}))
                return response['decision']
            except Exception as error:
                if self._process and self._process.is_alive():
                    self._update(phase='ready', message=str(error))
                else:
                    self._update(phase='error', message=str(error))
                raise

    def close(self):
        # Termination also interrupts a long native generation or load without waiting on the GIL.
        with self._lock:
            self._update(phase='unloaded', name='', message='Select and load a GGUF model.')
            if self._process:
                if self._process.is_alive():
                    self._process.terminate()
                self._process.join(timeout=5)
                self._process.close()
                self._process = None
            if self._pipe:
                self._pipe.close()
                self._pipe = None
            self._config = None
            self._update(phase='unloaded', name='', message='Select and load a GGUF model.')
