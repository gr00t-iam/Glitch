"""Cancellation-aware shared desktop/workspace ownership after approval."""
import os
import threading
from contextlib import contextmanager


class ResourceCoordinator:
    def __init__(self):
        self.guard = threading.Lock()
        self.desktop = threading.Lock()
        self.workspaces = {}
        self.local = threading.local()

    def acquire(self, action, workspace, cancel):
        with self.guard:
            lock = (self.workspaces.setdefault(os.path.normcase(os.path.realpath(workspace)), threading.Lock())
                    if action in ('Write file', 'Run command') else self.desktop)
        while not lock.acquire(timeout=.1):
            if cancel.is_set():
                raise InterruptedError('Stopped waiting for shared resources.')
        if cancel.is_set():
            lock.release()
            raise InterruptedError('Stopped.')
        self.local.held = lock

    def release(self):
        lock = getattr(self.local, 'held', None)
        if lock:
            self.local.held = None
            lock.release()

    @contextmanager
    def lease(self, action, workspace, cancel):
        self.acquire(action, workspace, cancel)
        try:
            yield
        finally:
            self.release()


SHARED_RESOURCES = ResourceCoordinator()
