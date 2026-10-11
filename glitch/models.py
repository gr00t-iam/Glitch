"""Embedded worker and optional supervisor, independent of external model servers."""

import threading

from glitch.shared_runtime import SharedModelRuntime
from glitch.model_manager import ModelManager
from glitch.supervisor import SupervisorBridge

DECISION_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['message', 'done', 'tool'],
    'properties': {
        'message': {'type': 'string'}, 'done': {'type': 'boolean'},
        'tool': {'anyOf': [{'type': 'null'}, {'type': 'object', 'additionalProperties': False,
            'required': ['name', 'args'], 'properties': {'name': {'type': 'string'}, 'args': {'type': 'object'}}}]},
    },
}


class ModelClient:
    def __init__(self, store, worker=None):
        self.store = store
        self.library = ModelManager(store.directory / 'models')
        self.worker = worker or SharedModelRuntime()
        self.supervisor = SupervisorBridge(store)
        self._load_thread = None
        self._cancel_load = threading.Event()
        self._load_lock = threading.Lock()

    def discover(self, settings=None):
        return self.library.catalog()

    def status(self):
        return {'transfer': self.library.status(), 'inference': self.worker.status(), 'models': self.discover()}

    def load(self, settings):
        path = self.library.path(settings['worker_model'])
        projector = self.library.path(settings['vision_projector']) if settings['vision_projector'] else None
        with self._load_lock:
            if self._load_thread and self._load_thread.is_alive():
                raise ValueError('A model is already loading.')
            self._cancel_load.clear()
            def run():
                try:
                    self.worker.load(path, settings, self._cancel_load, projector)
                except Exception:
                    # The worker exposes the error through its status, without a background traceback.
                    pass
            self._load_thread = threading.Thread(target=run, daemon=True)
            self._load_thread.start()
        return {'ok': True, 'message': 'Loading model...'}

    def chat(self, settings, messages, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        # Model Manager may already be loading. Wait on the agent thread, never the UI bridge.
        while self._load_thread and self._load_thread.is_alive():
            if cancel.wait(0.1):
                raise InterruptedError('Stopped while loading the local model.')
        state = self.worker.status()
        if state['name'] != settings['worker_model'] or state['phase'] not in ('ready', 'generating'):
            path = self.library.path(settings['worker_model'])
            projector = self.library.path(settings['vision_projector']) if settings['vision_projector'] else None
            self.worker.load(path, settings, cancel, projector)
        return self.store.redact(self.worker.chat(self.store.redact(messages), DECISION_SCHEMA, cancel))

    def review(self, settings, task, actions, reason, cancel):
        return self.supervisor.review(settings, task, actions, reason, cancel)

    def unload(self):
        self._cancel_load.set()
        if self._load_thread and self._load_thread.is_alive():
            self._load_thread.join(timeout=7)
        self.worker.close()

    def close(self):
        self.library.cancel()
        self.unload()
