"""Conditional cloud audits based on actual tool results."""

import json


class TriggerMonitor:
    def __init__(self, interval=5):
        self.interval = interval

    def evaluate(self, actions):
        if not actions:
            return None
        if not actions[-1]['ok']:
            return 'A tool error needs inspection.'
        recent = actions[-3:]
        signatures = [json.dumps([a['tool'], a['args']], sort_keys=True) for a in recent]
        if len(signatures) == 3 and len(set(signatures)) == 1:
            return 'Repeated action loop detected.'
        if len(actions) % self.interval == 0:
            return f'Routine review after {self.interval} tool steps.'
        return None
