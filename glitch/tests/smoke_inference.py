"""Frozen native DLL/process check with a real GGUF, not a mocked model server."""

import json
import threading
from pathlib import Path


def run(output_directory, model_path):
    from glitch.local_inference import EmbeddedWorker
    from glitch.storage import DEFAULTS
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    worker = EmbeddedWorker()
    try:
        worker.load(Path(model_path).resolve(strict=True), DEFAULTS | {'context_length': 1024, 'cpu_threads': 2}, threading.Event())
        result['checks'].append('Bundled llama.cpp native DLLs load a real GGUF in an isolated child process')
        schema = {'type': 'object', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok'], 'additionalProperties': False}
        decision = worker.chat([{'role': 'user', 'content': 'Return a JSON object with ok true.'}], schema, threading.Event())
        assert isinstance(decision, dict) and isinstance(decision.get('ok'), bool), decision
        result['checks'].append('Real local generation returns schema-constrained JSON without an HTTP model server')
        result['decision'] = decision
        result['usage'] = worker.status()['usage']
        worker.close()
        assert worker.status()['phase'] == 'unloaded'
        result['checks'].append('Unload terminates the child process and releases model resources')
        result['passed'] = True
    except Exception as error:
        result['error'] = str(error)
    finally:
        worker.close()
        (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result
