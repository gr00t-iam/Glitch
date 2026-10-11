"""Explicit API billing or a user-configured, authorized loopback account bridge."""

import json
import threading
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
        endpoint, provider, model, headers = self._configuration(settings)
        result = {'ok': False, 'catalog_ok': False, 'generation_ok': False, 'models': [], 'model': model}
        try:
            with requests.get(endpoint + '/models', headers=headers, timeout=(5, 15), allow_redirects=False) as response:
                self._check(response)
                result['models'] = [item['id'] for item in response.json().get('data', [])
                                    if isinstance(item, dict) and isinstance(item.get('id'), str)]
                result['catalog_ok'] = True
        except (requests.RequestException, RuntimeError, ValueError, TypeError):
            pass  # Catalog access and generation permission are independent checks.
        try:
            self._generate(settings, 'Return exactly GLITCH_CONNECTION_OK.',
                                   'Synthetic connection probe. Do not use tools.', threading.Event())
            result.update(ok=True, generation_ok=True,
                          message=f'Selected model {model}: real generation verified. Model catalog ' +
                          ('verified.' if result['catalog_ok'] else 'unavailable.') + ' Future usage and plan limits still apply.')
        except (requests.RequestException, RuntimeError, ValueError, KeyError, TypeError, IndexError) as error:
            result['message'] = f'Selected model {model}: generation failed. Model catalog ' + (
                'verified; listing alone is not a connection proof. ' if result['catalog_ok'] else 'unavailable. ') + str(error)
        return self.store.redact(result)

    def review(self, settings, task, actions, reason, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        from glitch.redaction import fields, action
        audit = json.dumps(self.store.redact({'task': task, 'reason': reason, 'recent_actions': actions[-15:]},
                                           fields('task', 'reason', recent_actions=[action])))[:24000]
        return self._generate(settings, AUDITOR, audit, cancel)

    def _generate(self, settings, system, content, cancel):
        if cancel.is_set():
            raise InterruptedError('Stopped.')
        endpoint, provider, model, headers = self._configuration(settings)
        body = {'model': model, 'max_tokens': 600,
                'messages': [{'role': 'user', 'content': content}]}
        # Authorized bridges choose their own sampler; OpenAI reasoning models
        # also reject non-default temperature. Never retry with another identity.
        if settings['supervisor_auth'] != 'proxy' and not (
                provider == 'openai' and model.lower().startswith(('o1', 'o3', 'o4', 'gpt-5', 'gpt-6'))):
            body['temperature'] = 0.1
        if provider == 'anthropic':
            body['system'] = system
            route = '/messages'
        else:
            body['messages'].insert(0, {'role': 'system', 'content': system})
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
