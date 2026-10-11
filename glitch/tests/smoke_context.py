"""Isolated compaction smoke, callable by a future frozen acceptance entrypoint.

Uses an exact fixture tokenizer, never user data, a downloaded model or cloud.
Source: python -m glitch.tests.smoke_context --output <evidence.json>
"""
import argparse
import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch


def run(output=None):
    from glitch.api import DesktopAPI
    from glitch.context import ContextManager
    from glitch.engine import AgentEngine
    from glitch.storage import Store, DEFAULTS
    from glitch.tests.test_context import ExactModels

    with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}), \
            tempfile.TemporaryDirectory(prefix='glitch-context-smoke-') as folder:
        root = Path(folder)
        store = Store(root / 'data')
        session = store.new_session(root)
        original_id = store.message(session, 'user', 'Keep approvals; no cloud, publish or credentials.')
        for _ in range(8):
            store.message(session, 'assistant', 'Older unverified commentary. ' * 70)
        store.message(session, 'user', 'Continue safely.')
        originals = store.messages(session)
        models = ExactModels()
        engine = AgentEngine(store, models)
        engine.running_session = session
        settings = DEFAULTS | {'context_length': 12000, 'parallel_streams': 4, 'mode': 'local'}
        system = {'role': 'system', 'content': 'Preserve all safety gates.'}
        manager = ContextManager(store, models)
        prompt = manager.prepare(session, system, None, settings, threading.Event(), engine._emit)
        checkpoint = store.context_checkpoint(session)
        assert checkpoint is not None and type(checkpoint['token_count']) is int
        assert store.messages(session) == originals
        assert originals[0]['content'] in '\n'.join(m['content'] for m in prompt)
        restored = ContextManager(Store(store.directory), models).prepare(
            session, system, None, settings, threading.Event(), lambda *_: None)
        assert restored == prompt
        quotation = manager.execute(session, {'start_id': original_id, 'end_id': original_id, 'limit': 1})
        assert quotation['messages'][0]['content'] == originals[0]['content']
        event = next(e for e in DesktopAPI(store, engine, models).poll(session, 0)['events']
                     if e['kind'] == 'context_refreshed')
        assert event['payload']['prompt_count'] == checkpoint['token_count']
        result = {'passed': True, 'execution': 'frozen' if getattr(sys, 'frozen', False) else 'source',
                  'tokenizer': 'exact deterministic fixture, not a live model',
                  'prompt_count': checkpoint['token_count'], 'output_reserve': 1536, 'margin': 32,
                  'checks': ['local checkpoint', 'critical constraints', 'original archive retained',
                             'checkpoint restart', 'exact bounded quotation', 'persisted UI telemetry']}
    if output is not None:
        output = Path(output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    print(json.dumps(run(parser.parse_args().output), indent=2))
