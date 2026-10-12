"""Cancellation-aware shared desktop/workspace ownership after approval."""
import os
import threading
import time
from contextlib import contextmanager


def workspace_identity(workspace):
    return os.path.normcase(os.path.realpath(workspace))


def overlaps(first, second):
    try:
        return os.path.commonpath((first, second)) in (first, second)
    except ValueError:
        return False


class ResourceRefusal(ValueError):
    """Host-authored admission guidance, without workspace or caller text."""


class _WorkspaceLock:
    """Overlap-aware lock facade, also used by nonblocking history admission."""
    def __init__(self, resources, key):
        self.resources, self.key = resources, key

    def acquire(self, blocking=True, timeout=-1, *, cancel=None, action=None):
        resources, owner = self.resources, threading.get_ident()
        deadline = time.monotonic() + timeout if timeout >= 0 else float('inf')
        request = object()
        with resources.changed:
            resources.waiters.append((request, self.key, owner))
            resources.changed.notify_all()
            try:
                while True:
                    if cancel is not None and cancel.is_set():
                        raise InterruptedError('Stopped waiting for shared resources.')
                    resources._review_gate(action, self.key)
                    owned = [key for key, (thread, _) in resources.claims.items() if thread == owner]
                    busy = any(thread != owner and overlaps(self.key, key)
                               for key, (thread, _) in resources.claims.items())
                    before = resources.waiters[:next(i for i, row in enumerate(resources.waiters) if row[0] is request)]
                    blocked = []
                    for _, key, thread in before:
                        if thread != owner and any(overlaps(key, scope) for scope in owned + blocked):
                            blocked.append(key)
                    # Only bypass predecessors blocked by our own existing scopes
                    # (including their queued dependents), never an unrelated lease.
                    earlier = any(thread != owner and overlaps(self.key, key) and key not in blocked
                                  for _, key, thread in before)
                    if not busy and not earlier:
                        _, count = resources.claims.get(self.key, (owner, 0))
                        resources.claims[self.key] = (owner, count + 1)
                        return True
                    if owned and busy:
                        raise ResourceRefusal('Release the outer workspace lease before requesting a conflicting nested scope.')
                    if not blocking or time.monotonic() >= deadline:
                        return False
                    resources.changed.wait(min(.1, max(0, deadline - time.monotonic())))
            finally:
                resources.waiters[:] = [row for row in resources.waiters if row[0] is not request]
                resources.changed.notify_all()

    def release(self):
        with self.resources.changed:
            owner, count = self.resources.claims[self.key]
            if count == 1:
                del self.resources.claims[self.key]
            else:
                self.resources.claims[self.key] = (owner, count - 1)
            self.resources.changed.notify_all()


class ResourceCoordinator:
    def __init__(self):
        self.guard = threading.RLock()
        self.changed = threading.Condition(self.guard)
        self.desktop = threading.Lock()
        self.workspaces = {}
        self.claims = {}
        self.waiters = []
        self.reviews = []
        self.local = threading.local()
        self.automation = 0
        self.human_reviews = 0

    def workspace_lock(self, workspace):
        key = workspace_identity(workspace)
        with self.guard:
            return self.workspaces.setdefault(key, _WorkspaceLock(self, key))

    def _review_gate(self, action, key):
        if action is None:
            return
        owned = any(owner == threading.get_ident() and overlaps(key, scope)
                    for scope, (owner, _) in self.claims.items())
        if action in ('Desktop Input', 'Run command') and self.reviews:
            if not (getattr(self.local, 'held', None) and all(not review['active'] for review in self.reviews)):
                raise ResourceRefusal('Agent input and commands are paused during GitHub human review.')
        if action in ('Write file', 'Run command', 'GitHub mutation'):
            blocked = [review for review in self.reviews if review['workspace'] is not None and
                       overlaps(key, review['workspace'])]
            if blocked and not (owned and all(not review['active'] for review in blocked)):
                raise ResourceRefusal('Overlapping workspace mutations are paused during GitHub human review.')

    def require_idle(self, workspaces):
        """Called under history admission's guard; include related roots/reviews."""
        with self.guard:
            for workspace in workspaces:
                key = workspace_identity(workspace)
                if (any(overlaps(key, scope) for scope in self.claims) or
                        any(overlaps(key, scope) for _, scope, _ in self.waiters) or
                        any(review['workspace'] is not None and overlaps(key, review['workspace']) for review in self.reviews)):
                    raise ResourceRefusal('Wait for overlapping workspace operations and GitHub reviews before removing history.')

    def acquire(self, action, workspace, cancel):
        automation = action in ('Desktop Input', 'Run command')
        key = workspace_identity(workspace)
        with self.guard:
            self._review_gate(action, key)
            lock = (self.workspace_lock(workspace)
                    if action in ('Write file', 'Run command', 'GitHub mutation') else self.desktop)
            self.automation += int(automation)
        try:
            if isinstance(lock, _WorkspaceLock):
                lock.acquire(cancel=cancel, action=action)
            else:
                while not lock.acquire(timeout=.1):
                    if cancel.is_set():
                        raise InterruptedError('Stopped waiting for shared resources.')
            if cancel.is_set():
                lock.release()
                raise InterruptedError('Stopped.')
            stack = getattr(self.local, 'stack', [])
            stack.append((lock, automation))
            self.local.stack = stack
            self.local.held = lock
            self.local.automation = automation
        except BaseException:
            with self.guard:
                self.automation -= int(automation)
                self.changed.notify_all()
            raise

    def release(self):
        stack = getattr(self.local, 'stack', [])
        if stack:
            lock, automation = stack.pop()
            self.local.held = stack[-1][0] if stack else None
            with self.guard:
                self.automation -= int(automation)
                self.local.automation = stack[-1][1] if stack else False
                lock.release()
                self.changed.notify_all()

    @contextmanager
    def human_review(self, cancel, *, workspace=None):
        """Policy marker, not a lease: no mutex stays held while the human decides.

        Drain already admitted automation before showing approval. Commands can
        run project code, so they too must not manufacture a desktop approval.
        """
        with self.guard:
            if getattr(self.local, 'held', None) or any(owner == threading.get_ident() for owner, _ in self.claims.values()):
                raise ResourceRefusal('Release resource leases before requesting GitHub human review.')
        scope = workspace_identity(workspace) if workspace is not None else None
        review = {'workspace': scope, 'active': False}
        deadline = time.monotonic() + 300
        with self.changed:
            self.reviews.append(review)
            self.human_reviews += 1
            self.changed.notify_all()
        try:
            with self.changed:
                while True:
                    if cancel.is_set():
                        raise InterruptedError('Stopped before GitHub human review.')
                    busy = scope is not None and any(overlaps(scope, key) for key in self.claims)
                    if not self.automation and not busy:
                        review['active'] = True
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Stop active overlapping mutations or automation before GitHub human review.')
                    self.changed.wait(.1)
            yield
        finally:
            with self.changed:
                self.reviews[:] = [item for item in self.reviews if item is not review]
                self.human_reviews -= 1
                self.changed.notify_all()

    @contextmanager
    def lease(self, action, workspace, cancel):
        self.acquire(action, workspace, cancel)
        try:
            yield
        finally:
            self.release()


SHARED_RESOURCES = ResourceCoordinator()
