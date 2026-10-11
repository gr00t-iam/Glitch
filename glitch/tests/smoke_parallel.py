"""Real shared-weight concurrency and individual cancellation release gate."""
import json
import threading
import time
from pathlib import Path
from unittest.mock import patch
import subprocess
from glitch.shared_runtime import SharedModelRuntime
from glitch.storage import DEFAULTS


def run(output_directory, model_path):
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    runtime = SharedModelRuntime()
    cancellations = [threading.Event() for _ in range(4)]
    threads = []
    try:
        # This 15M fixture was trained at 128 tokens. Override its test-only
        # metadata to exercise large simultaneous output, not model quality.
        original = subprocess.Popen
        with patch('glitch.shared_runtime.subprocess.Popen', side_effect=lambda argv, **kw: original(argv + ['--override-kv', 'llama.context_length=int:4096'], **kw)):
            runtime.load(Path(model_path), DEFAULTS | {'parallel_streams': 4, 'context_length': 1024, 'cpu_threads': 2}, threading.Event())
        pid = runtime.status()['pid']
        slots = runtime.slots()
        assert len(slots) == 4, slots
        result['slots'] = slots
        phrase = 'hello ' * 300
        schema = {'type': 'object', 'properties': {'text': {'type': 'string', 'enum': [phrase]}}, 'required': ['text'], 'additionalProperties': False}
        barrier = threading.Barrier(5)
        answers = {}
        def generate(i):
            barrier.wait()
            try:
                answers[i] = runtime.chat([{'role': 'user', 'content': 'Write the required JSON.'}], schema, cancellations[i])
            except Exception as error:
                answers[i] = type(error).__name__ + ': ' + str(error)
        threads = [threading.Thread(target=generate, args=(i,)) for i in range(4)]
        for thread in threads:
            thread.start()
        barrier.wait()
        deadline = time.monotonic() + 30
        max_busy = 0
        while time.monotonic() < deadline:
            live = runtime.slots()
            busy = sum(s.get('is_processing', False) for s in live)
            max_busy = max(max_busy, busy)
            if busy == 4:
                break
            time.sleep(.02)
        assert max_busy == 4, f'Only {max_busy} server slots overlapped'
        assert runtime.status()['pid'] == pid
        result['checks'].append('Four real server slots overlap with one PID and one GGUF load')
        try:
            runtime.chat([{'role': 'user', 'content': 'Fifth'}], schema, threading.Event())
            raise AssertionError('Fifth request was not bounded')
        except ValueError as error:
            assert 'busy' in str(error)
        cancellations[0].set()
        for thread in threads:
            thread.join(timeout=60)
        assert all(not t.is_alive() for t in threads), 'Generation threads did not stop'
        assert isinstance(answers.get(0), str) and answers[0].startswith('InterruptedError'), answers
        assert all(isinstance(answers.get(i), dict) for i in range(1, 4)), answers
        assert runtime.status()['pid'] == pid
        result['checks'].append('Cancelling one stream leaves the three siblings running to completion')
        small = {'type': 'object', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok'], 'additionalProperties': False}
        assert isinstance(runtime.chat([{'role': 'user', 'content': 'Return JSON.'}], small, threading.Event())['ok'], bool)
        result['checks'].append('Cancelled capacity is reusable without restarting the server')
        result.update(passed=True, pid=pid, max_occupied=max_busy)
    except Exception as error:
        result['error'] = str(error)
    finally:
        for cancel in cancellations:
            cancel.set()
        runtime.close()
        for thread in threads:
            thread.join(timeout=5)
        result['shutdown'] = runtime.status()['phase'] == 'unloaded'
        (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result
