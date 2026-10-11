"""Explicit API billing or a user-configured, authorized loopback account bridge."""

import json
from urllib.parse import urlsplit

import requests

AUDITOR = ('You are Glitch, an auditor of a local worker. Inspect actual tool evidence for errors, loops '
           'and unsupported claims. Return a concise Course Correction Directive with verified next steps. '
           'Do not grant approvals, repeat credentials or bypass safety. If no drift exists, give a brief continuation anchor.')


def loopback_url(value):
    url = urlsplit(value)
    if (url.scheme not in ('http', 'https') or url.hostname not in ('127.0.0.1', 'localhost', '::1') or
            url.username is not None or url.password is not None or url.query or url.fragment or
            url.port == 0 or any(c.isspace() for c in value)):
        raise ValueError('The account bridge must use a loopback HTTP(S) URL without credentials or query parameters.')
    return value.rstrip('/')


class SupervisorBridge:
    def __init__(self, store):
        self.store = store

    def _configuration(self, settings, require_model=True):
        proxy = settings['supervisor_auth'] == 'proxy'
        endpoint = loopback_url(settings['proxy_url']) if proxy else settings['supervisor_url']
        key = self.store.proxy_token() if proxy else self.store.supervisor_key()
        if not proxy and not key:
            raise ValueError('Enter a supervisor API key, or connect an authorized account bridge.')
        provider = 'compatible' if proxy else settings['supervisor_provider']
        model = settings['proxy_model'] if proxy else settings['supervisor_model']
        if require_model and not model.strip():
            raise ValueError('Choose a supervisor model.')
        headers = {'X-Title': 'Glitch Desktop'}
        if key:
            if provider == 'anthropic':
                headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
            else:
                headers['Authorization'] = 'Bearer ' + key
        return endpoint, provider, model, headers

    @staticmethod
    def _check(response):
        if not response.ok:
            raise RuntimeError(f'Supervisor returned HTTP {response.status_code}. Check connection, credentials and model access.')

    def test(self, settings):
        endpoint, provider, _, headers = self._configuration(settings, require_model=False)
        with requests.get(endpoint + '/models', headers=headers, timeout=(5, 15), allow_redirects=False) as response:
            self._check(response)
            models = [item['id'] for item in response.json().get('data', []) if isinstance(item.get('id'), str)]
        return self.store.redact({'ok': True, 'models': models, 'message': 'Connected. Model listing verified; generation and plan limits depend on the provider.'})

    def review(self, settings, task, actions, reason, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        endpoint, provider, model, headers = self._configuration(settings)
        from glitch.redaction import fields, action
        audit = json.dumps(self.store.redact({'task': task, 'reason': reason, 'recent_actions': actions[-15:]},
                                           fields('task', 'reason', recent_actions=[action])))[:24000]
        body = {'model': model, 'max_tokens': 600, 'temperature': 0.1,
                'messages': [{'role': 'user', 'content': audit}]}
        if provider == 'anthropic':
            body['system'] = AUDITOR
            route = '/messages'
        else:
            body['messages'].insert(0, {'role': 'system', 'content': AUDITOR})
            route = '/chat/completions'
        with requests.post(endpoint + route, headers=headers, json=body, timeout=(5, 60), allow_redirects=False) as response:
            self._check(response)
            data = response.json()
            if provider == 'anthropic':
                directive = '\n'.join(block['text'] for block in data.get('content', []) if block.get('type') == 'text')
            else:
                directive = data['choices'][0]['message']['content']
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        if not isinstance(directive, str) or not directive.strip():
            raise RuntimeError('Supervisor returned no correction directive.')
        return self.store.redact(directive.strip())[:6000]
