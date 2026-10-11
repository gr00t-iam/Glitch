import tempfile
import threading
import time
import unittest
from glitch.resources import ResourceCoordinator


class ResourceTests(unittest.TestCase):
    def test_cancelled_workspace_waiter_does_not_enter(self):
        resources = ResourceCoordinator()
        with tempfile.TemporaryDirectory() as root:
            resources.acquire('Write file', root, threading.Event())
            cancelled = threading.Event()
            result = []
            def waiter():
                try:
                    resources.acquire('Run command', root, cancelled)
                    result.append('entered')
                    resources.release()
                except InterruptedError:
                    result.append('cancelled')
            thread = threading.Thread(target=waiter)
            thread.start()
            cancelled.set()
            thread.join(timeout=2)
            self.assertEqual(result, ['cancelled'])
            resources.release()

    def test_desktop_input_cannot_overlap(self):
        resources = ResourceCoordinator()
        active = 0
        maximum = 0
        guard = threading.Lock()
        def operation():
            nonlocal active, maximum
            resources.acquire('Desktop Input', '.', threading.Event())
            with guard:
                active += 1
                maximum = max(maximum, active)
            time.sleep(.02)
            with guard:
                active -= 1
            resources.release()
        threads = [threading.Thread(target=operation) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2)
        self.assertEqual(maximum, 1)
