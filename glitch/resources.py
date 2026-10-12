"""Cancellation-aware shared desktop/workspace ownership after approval."""
import os
import threading
import time
from contextlib import contextmanager


class ResourceCoordinator:
    def __init__(self):
        self.guard = threading.Lock()
        self.desktop = threading.Lock()
        self.workspaces = {}
        self.local = threading.local()
        self.automation = 0
        self.human_reviews = 0

    def acquire(self, action, workspace, cancel):
        automation = action in ('Desktop Input', 'Run command')
        with self.guard:
            if automation and self.human_reviews:
                raise ValueError('Agent input and commands are paused during GitHub human review.')
            lock = (self.workspaces.setdefault(os.path.normcase(os.path.realpath(workspace)), threading.Lock())
                    if action in ('Write file', 'Run command', 'GitHub mutation') else self.desktop)
            self.automation += int(automation)
        try:
            while not lock.acquire(timeout=.1):
                if cancel.is_set():
                    raise InterruptedError('Stopped waiting for shared resources.')
            if cancel.is_set():
                lock.release()
                raise InterruptedError('Stopped.')
            self.local.held = lock
            self.local.automation = automation
        except BaseException:
            with self.guard:
                self.automation -= int(automation)
            raise

    def release(self):
        lock = getattr(self.local, 'held', None)
        if lock:
            self.local.held = None
            with self.guard:
                self.automation -= int(getattr(self.local, 'automation', False))
                self.local.automation = False
                lock.release()

    @contextmanager
    def human_review(self, cancel):
        """Policy marker, not a lease: no mutex stays held while the human decides.

        Drain already admitted automation before showing approval. Commands can
        run project code, so they too must not manufacture a desktop approval.
        """
        deadline = time.monotonic() + 300
        while True:
            if cancel.is_set():
                raise InterruptedError('Stopped before GitHub human review.')
            with self.guard:
                if not self.automation:
                    self.human_reviews += 1
                    break
            if time.monotonic() >= deadline:
                raise TimeoutError('Stop active agent input or commands before GitHub human review.')
            cancel.wait(.1)
        try:
            yield
        finally:
            with self.guard:
                self.human_reviews -= 1

    @contextmanager
    def lease(self, action, workspace, cancel):
        self.acquire(action, workspace, cancel)
        try:
            yield
        finally:
            self.release()


SHARED_RESOURCES = ResourceCoordinator()
