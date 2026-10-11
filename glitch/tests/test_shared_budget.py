import tempfile
import threading
import unittest
from pathlib import Path

from glitch.storage import Store, DEFAULTS


class SharedBudgetTests(unittest.TestCase):
    def test_one_total_context_with_cuda_auto_offload(self):
        from glitch.shared_runtime import runtime_arguments
        args = runtime_arguments('runtime.exe', 'model.gguf', DEFAULTS | {
            'parallel_streams': 4, 'context_length': 65535}, 1234, 'cuda')
        self.assertEqual(args[args.index('--ctx-size') + 1], '65535')
        self.assertIn('--kv-unified', args)
        self.assertNotIn('--no-kv-unified', args)
        self.assertIn('--cont-batching', args)
        self.assertEqual(args[args.index('--n-gpu-layers') + 1], 'auto')
        self.assertIn('--jinja', args)
        self.assertNotIn('--no-jinja', args)

    def test_backend_cpu_does_not_offload(self):
        from glitch.shared_runtime import runtime_arguments
        args = runtime_arguments('runtime.exe', 'model.gguf', DEFAULTS, 1234, 'cpu')
        self.assertEqual(args[args.index('--n-gpu-layers') + 1], '0')

    def test_pool_allocation_accepts_padding_not_multiplication(self):
        from glitch.shared_runtime import validate_context_allocation
        validate_context_allocation([{'n_ctx': 65536}] * 4, 4, 65535)
        for count in (16384, 262144):
            with self.assertRaises(RuntimeError):
                validate_context_allocation([{'n_ctx': count}] * 4, 4, 65535)

    def test_budget_borrows_unused_capacity_and_wait_is_cancelable(self):
        from glitch.shared_runtime import ContextBudget
        pool = ContextBudget(100)
        a = pool.acquire(80, threading.Event())
        b = pool.acquire(20, threading.Event())
        cancel = threading.Event()
        errors = []
        def wait():
            try:
                pool.acquire(1, cancel)
            except InterruptedError:
                errors.append('cancelled')
        thread = threading.Thread(target=wait)
        thread.start()
        cancel.set()
        thread.join(2)
        self.assertEqual(errors, ['cancelled'])
        pool.release(a)
        c = pool.acquire(80, threading.Event())
        pool.release(b)
        pool.release(c)
        self.assertEqual(pool.used, 0)
        with self.assertRaises(ValueError):
            pool.acquire(101, threading.Event())

    def test_saved_bad_projector_is_repaired_and_new_invalid_value_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            with store.connect() as db:
                for key in ('worker_model', 'vision_projector'):
                    db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', (key, '"Muse.gguf"'))
            repaired = Store(Path(root))
            self.assertEqual(repaired.settings()['vision_projector'], '')
            with self.assertRaises(ValueError):
                repaired.save_settings({'worker_model': 'Muse.gguf', 'vision_projector': 'Muse.gguf'})

    def test_gpu_setting_is_explicit_and_validated(self):
        with tempfile.TemporaryDirectory() as root:
            store = Store(Path(root))
            self.assertEqual(store.settings()['gpu_mode'], 'auto')
            self.assertEqual(store.save_settings({'gpu_mode': 'cpu'})['gpu_mode'], 'cpu')
            with self.assertRaises(ValueError):
                store.save_settings({'gpu_mode': 'anything'})
