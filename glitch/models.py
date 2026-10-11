"""Bounded HTTP calls to Ollama and OpenAI-compatible cloud supervisors."""

import json
import threading

import requests

from glitch.storage import redact

DECISION_SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['message', 'done', 'tool'],
    'properties': {
        'message': {'type': 'string'}, 'done': {'type': 'boolean'},
        'tool': {'anyOf': [{'type': 'null'}, {'type': 'object', 'additionalProperties': False,
            'required': ['name', 'args'], 'properties': {'name': {'type': 'string'}, 'args': {'type': 'object'}}}]},
    },
}


class ModelClient:
    def __init__(self, store):
        self.store = store

    @staticmethod
    def _check(response, provider):
        if not response.ok:
            raise RuntimeError(f'{provider} returned HTTP {response.status_code}. Check the endpoint, model and credentials.')

    def discover(self, settings):
        with requests.get(settings['ollama_url'] + '/api/tags', timeout=(5, 15), allow_redirects=False) as response:
            self._check(response, 'Ollama')
            return [{'name': m['name'], 'size': m.get('size', 0)} for m in response.json().get('models', [])]

    def chat(self, settings, messages, cancel: threading.Event):
        if not settings['worker_model']:
            raise ValueError('Choose a downloaded local model in Settings.')
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        try:
            with requests.post(settings['ollama_url'] + '/api/chat', json={
                'model': settings['worker_model'], 'messages': messages,
                'format': DECISION_SCHEMA, 'stream': False, 'options': {'temperature': 0.15},
            }, timeout=(5, 120), allow_redirects=False) as response:
                self._check(response, 'Ollama')
                data = response.json()
            if cancel.is_set():
                raise InterruptedError('Stopped.')
            return json.loads(data['message']['content'])
        except requests.RequestException as error:
            raise RuntimeError('Cannot reach Ollama. Check that the Ollama Windows app is running and the endpoint is correct.') from error

    def review(self, settings, task, actions, reason, cancel):
        key = self.store.supervisor_key()
        if not key:
            raise RuntimeError('Hybrid mode needs a supervisor API key in Settings.')
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        # Only a bounded, redacted audit is sent outside the machine, never the complete conversation.
        audit = redact(json.dumps({'task': task, 'reason': reason, 'recent_actions': actions[-15:]}))[:24000]
        with requests.post(settings['supervisor_url'] + '/chat/completions', headers={
            'Authorization': 'Bearer ' + key, 'X-Title': 'Glitch Desktop',
        }, json={
            'model': settings['supervisor_model'], 'temperature': 0.1, 'max_tokens': 600,
            'messages': [
                {'role': 'system', 'content': 'You are Glitch, an auditor of a local worker. Inspect actual tool evidence for errors, loops and unsupported claims. Return a concise Course Correction Directive with the next verified steps. Do not grant approvals, repeat credentials, or suggest bypassing safety. If no drift exists, say so and give a brief continuation anchor.'},
                {'role': 'user', 'content': audit},
            ],
        }, timeout=(5, 60), allow_redirects=False) as response:
            self._check(response, 'Supervisor')
            directive = response.json()['choices'][0]['message']['content']
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        if not isinstance(directive, str) or not directive.strip():
            raise RuntimeError('Supervisor returned an empty directive.')
        return redact(directive.strip()[:6000])
