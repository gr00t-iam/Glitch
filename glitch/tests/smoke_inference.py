"""Single-stream check of the shipped private runtime with a real GGUF."""

import json
import hashlib
import subprocess
import threading
from pathlib import Path
from unittest.mock import patch


def run(output_directory, model_path):
    from glitch.shared_runtime import SharedModelRuntime
    from glitch.storage import DEFAULTS
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    worker = SharedModelRuntime()
    try:
        model = Path(model_path).resolve(strict=True)
        # Only the pinned 15M test fixture has its 128-token training limit
        # overridden. Real application models never receive this override.
        fixture = model.stat().st_size <= 32 * 1024 * 1024 and hashlib.sha256(model.read_bytes()).hexdigest() == '66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739'
        original = subprocess.Popen
        def launch(argv, **kwargs):
            if fixture:
                # The stories fixture has no instruction chat template. This
                # legacy test formatter must not disable real GGUF templates.
                argv = [arg for arg in argv if arg != '--jinja'] + ['--no-jinja', '--override-kv', 'llama.context_length=int:4096']
            return original(argv, **kwargs)
        with patch('glitch.shared_runtime.subprocess.Popen', side_effect=launch):
            worker.load(model, DEFAULTS | {'context_length': 1024, 'cpu_threads': 2, 'parallel_streams': 1}, threading.Event())
        result['checks'].append('Bundled private llama.cpp process loads a real GGUF with one isolated slot')
        schema = {'type': 'object', 'properties': {'ok': {'type': 'boolean'}}, 'required': ['ok'], 'additionalProperties': False}
        decision = worker.chat([{'role': 'user', 'content': 'Return a JSON object with ok true.'}], schema, threading.Event())
        assert isinstance(decision, dict) and isinstance(decision.get('ok'), bool), decision
        result['checks'].append('Real local generation returns schema-constrained JSON without an external model service')
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
