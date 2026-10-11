"""Model protocol for pre-existing decision fakes, never a production fallback."""
import json


class ContextModelFixture:
    def count_prompt(self, settings, messages, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped')
        return len(json.dumps(messages).encode('utf-8')) // 8

    def summarize(self, settings, messages, schema, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped')
        return {'facts': []}
