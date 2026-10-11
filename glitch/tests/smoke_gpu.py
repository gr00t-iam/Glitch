"""Hardware acceptance: real user GGUF, CUDA, one shared 65,535-token pool."""
import json
import subprocess
import threading
import time
from pathlib import Path
from glitch.shared_runtime import SharedModelRuntime
from glitch.storage import DEFAULTS
from glitch.models import DECISION_SCHEMA


def gpu_memory():
    result = subprocess.run(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                            capture_output=True, text=True, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    result.check_returncode()
    return int(result.stdout.splitlines()[0])


def run(output_directory, model_path):
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    runtime = SharedModelRuntime()
    result = {'passed': False, 'checks': [], 'baseline_vram_mib': gpu_memory()}
    threads = []
    cancels = [threading.Event() for _ in range(4)]
    try:
        runtime.load(Path(model_path), DEFAULTS | {'context_length': 65535, 'parallel_streams': 4,
                     'gpu_mode': 'cuda', 'cpu_threads': 8}, threading.Event())
        initial = runtime.status()
        assert initial['backend'] == 'cuda' and initial['total_context'] == 65535, initial
        result['runtime'] = initial
        result['loaded_vram_mib'] = gpu_memory()
        result['peak_vram_mib'] = result['loaded_vram_mib']
        result['checks'].append('Muse Glimmer loads on CUDA with four slots and one 65,535-token budget')
        schema = {'type': 'object', 'properties': {'text': {'type': 'string', 'enum': ['verified ' * 100]}},
                  'required': ['text'], 'additionalProperties': False}
        barrier = threading.Barrier(5)
        answers = {}
        def generate(i):
            barrier.wait()
            try:
                answers[i] = runtime.chat([{'role': 'user', 'content': 'Return the required JSON.'}], schema, cancels[i])
            except Exception as error:
                answers[i] = type(error).__name__ + ': ' + str(error)
        threads = [threading.Thread(target=generate, args=(i,)) for i in range(4)]
        for thread in threads:
            thread.start()
        barrier.wait()
        deadline = time.monotonic() + 60
        occupied = 0
        while time.monotonic() < deadline:
            occupied = max(occupied, sum(s.get('is_processing', False) for s in runtime.slots()))
            result['peak_vram_mib'] = max(result['peak_vram_mib'], gpu_memory())
            if occupied == 4:
                break
            time.sleep(.1)
        result['answers_at_overlap'] = dict(answers)
        assert occupied == 4, f'Only {occupied} actual CUDA slots overlapped: {answers}'
        result['max_occupied'] = occupied
        result['checks'].append('Four actual Muse Glimmer requests overlap in one CUDA process')
        cancels[0].set()
        for thread in threads:
            thread.join(120)
        assert all(not thread.is_alive() for thread in threads), answers
        assert isinstance(answers.get(0), str) and answers[0].startswith('InterruptedError'), answers
        assert all(isinstance(answers.get(i), dict) for i in range(1, 4)), answers
        assert runtime.status()['pid'] == initial['pid']
        result['checks'].append('Stopping one stream preserves the three siblings and the loaded GPU model')
        reply = runtime.chat([{'role': 'system', 'content': 'Respond using the required JSON decision. For ordinary chat, tool is null and done is true.'},
                              {'role': 'user', 'content': 'Say hello briefly. Do not invoke tools.'}], DECISION_SCHEMA, threading.Event())
        assert reply.get('tool') is None and reply.get('done') is True and isinstance(reply.get('message'), str) and reply['message'].strip(), reply
        result['conversation_reply'] = reply
        result['checks'].append('Muse Glimmer returns an ordinary chat decision using the production agent schema')
        result['passed'] = True
    except Exception as error:
        result['error'] = str(error)
    finally:
        result['runtime_log'] = list(runtime.logs)
        for cancel in cancels:
            cancel.set()
        runtime.close()
        for thread in threads:
            thread.join(5)
        result['shutdown'] = runtime.status()['phase'] == 'unloaded'
        (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result
