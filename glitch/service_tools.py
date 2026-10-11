"""Host-only scoped credential use. No secret retrieval or caller auth headers."""
import base64
import http.client
import json
import ssl
import socket
import threading
import time
from urllib.parse import unquote, urlsplit

from glitch.computer import ChromeController
from glitch.redaction import RESULT
from glitch.resources import SHARED_RESOURCES
from glitch.vault import canonical_origin, REMOVED

METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
MAX_BYTES = 65536
TIMEOUT = 2
DEADLINE = 15

SERVICE_SCHEMAS = [
    {'name': 'list_connections', 'description': 'List registered connection IDs and metadata only; never retrieves secrets.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {}}},
    {'name': 'service_request', 'description': 'Request a relative HTTPS endpoint at the exact saved origin. Host supplies auth and verified TLS. Mutations require approval; redirects are refused.',
     'parameters': {'type': 'object', 'additionalProperties': False,
                    'required': ['credential_id', 'endpoint', 'method'], 'properties': {
                        'credential_id': {'type': 'string'}, 'endpoint': {'type': 'string'},
                        'method': {'type': 'string', 'enum': METHODS}, 'body': {'type': 'object'}}}},
    {'name': 'browser_fill_credential', 'description': 'Fill username/password inputs in the selected isolated Chrome tab after approval and exact HTTPS origin checks. Does not submit or return values.',
     'parameters': {'type': 'object', 'additionalProperties': False,
                    'required': ['credential_id', 'tab_id', 'username_selector', 'password_selector'],
                    'properties': {key: {'type': 'string'} for key in
                                   ('credential_id', 'tab_id', 'username_selector', 'password_selector')}}},
]


def relative_endpoint(value):
    """Reject ambiguous routes before any credential resolution or network access."""
    decoded = value
    for _ in range(10):
        parsed = urlsplit(decoded)
        if (parsed.scheme or parsed.netloc or decoded.startswith('//') or '#' in decoded or
                '\\' in decoded or any(ord(c) <= 32 or ord(c) == 127 for c in decoded) or
                any(segment in ('.', '..') for segment in parsed.path.split('/'))):
            raise ValueError('Use a relative endpoint without traversal, authority or fragment.')
        next_value = unquote(decoded, errors='strict')
        if next_value == decoded:
            return '/' + value.lstrip('/')
        decoded = next_value
    raise ValueError('Endpoint has excessive encoding.')


class ServiceTools:
    def __init__(self, vault, approve, emit, cancel):
        self.vault, self.approve, self.emit, self.cancel = vault, approve, emit, cancel
        self.resources = SHARED_RESOURCES
        self.chrome = ChromeController(vault.store.directory, cancel)

    def _check(self, deadline=None):
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        if deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError('Service request exceeded its time limit.')

    def execute(self, name, args):
        schema = next((t['parameters'] for t in SERVICE_SCHEMAS if t['name'] == name), None)
        if (schema is None or not isinstance(args, dict) or set(args) - set(schema['properties']) or
                any(key not in args for key in schema.get('required', []))):
            raise ValueError('Invalid scoped service tool arguments.')
        for key, value in args.items():
            rule = schema['properties'][key]
            if rule['type'] == 'string' and (not isinstance(value, str) or not value or len(value) > 4096):
                raise ValueError('Service inputs must be nonempty bounded text.')
            if 'enum' in rule and value not in rule['enum']:
                raise ValueError('Unsupported service method.')
            if rule['type'] == 'object' and not isinstance(value, dict):
                raise ValueError('Service body must be a structured object.')
        self._check()
        if name == 'list_connections':
            return self.vault.redact({'ok': True, 'connections': self.vault.list()}, RESULT)
        item = next((item for item in self.vault.list() if item['id'] == args['credential_id']), None)
        if item is None:
            raise ValueError('Credential does not exist.')
        origin = canonical_origin(item['origin'])
        if name == 'service_request':
            if item['kind'] not in ('bearer', 'basic', 'proxmox'):
                raise ValueError('This credential type is not supported by service requests.')
            endpoint = relative_endpoint(args['endpoint'])
            try:
                body = json.dumps(args['body'], allow_nan=False, ensure_ascii=True).encode() if 'body' in args else None
            except (ValueError, TypeError, RecursionError):
                raise ValueError('Service body must be a finite JSON object.') from None
            if body is not None and (len(body) > MAX_BYTES or args['method'] in ('GET', 'HEAD')):
                raise ValueError('Body is too large or not allowed for this method.')
            if args['method'] not in ('GET', 'HEAD') and not self.approve(name, args):
                return {'ok': False, 'denied': True, 'error': 'User denied service request.'}
            self._check()
            payload = self.vault.resolve(item['id'], origin)
            return self._request(item['kind'], origin, endpoint, args['method'], body, payload)
        if item['kind'] not in ('browser', 'basic'):
            raise ValueError('Browser fill requires a username/password credential.')
        if not self.approve(name, args):
            return {'ok': False, 'denied': True, 'error': 'User denied credential fill.'}
        self._check()
        with self.resources.lease('browser_fill_credential', '', self.cancel):
            self._check()
            try:
                result = self.chrome.fill_credential(args, origin, lambda: self.vault.resolve(item['id'], origin))
                self._check()
                return self.vault.redact(result, RESULT)
            except InterruptedError:
                raise
            except Exception as error:
                return self.vault.redact({'ok': False, 'error': str(error)}, RESULT)

    def _request(self, kind, origin, endpoint, method, body, payload):
        connection = None
        transport_socket = None
        watcher = None
        finished = threading.Event()
        deadline = time.monotonic() + DEADLINE
        try:
            context = ssl.create_default_context(cadata=payload.get('ca_pem'))
            if kind == 'proxmox':
                auth = 'PVEAPIToken=' + payload['token_id'] + '=' + payload['secret']
            elif kind == 'basic':
                auth = 'Basic ' + base64.b64encode((payload['username'] + ':' + payload['password']).encode()).decode('ascii')
            else:
                auth = 'Bearer ' + payload['token']
            target = urlsplit(origin)
            # http.client ignores ambient proxies, .netrc and environment auth.
            connection = http.client.HTTPSConnection(target.hostname, target.port or 443,
                                                      timeout=TIMEOUT, context=context)
            self._check(deadline)

            def guard():
                # Socket timeouts alone do not stop a peer dripping header bytes.
                while not finished.wait(.05):
                    if self.cancel.is_set() or time.monotonic() >= deadline:
                        active = connection.sock or transport_socket
                        if active is not None:
                            try:
                                active.shutdown(socket.SHUT_RDWR)
                            except OSError:
                                pass
                        return

            watcher = threading.Thread(target=guard, daemon=True)
            watcher.start()
            connection.connect()
            transport_socket = connection.sock
            # DNS/connect may finish after cancellation; never send auth then.
            self._check(deadline)
            connection.request(method, endpoint, body=body,
                               headers={'Authorization': auth, 'Accept': 'application/json',
                                        'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
            self._check(deadline)
            response = connection.getresponse()
            self._check(deadline)
            if 300 <= response.status < 400:
                return {'ok': False, 'status_code': response.status, 'error': 'Service redirect refused.'}
            content = bytearray()
            while len(content) <= MAX_BYTES:
                self._check(deadline)
                chunk = response.read1(min(8192, MAX_BYTES + 1 - len(content)))
                self._check(deadline)
                if not chunk:
                    break
                content.extend(chunk)
            # An incomplete body can end mid-credential. Discard oversized bodies
            # instead of returning a preview whose suffix may expose a secret prefix.
            text = '' if len(content) > MAX_BYTES else bytes(content).decode('utf-8', errors='replace')
            # Services sometimes reflect Authorization. Remove the whole derived
            # header/token before exact-value redaction (especially encoded Basic).
            text = text.replace(auth, REMOVED).replace(auth.split(' ', 1)[-1], REMOVED)
            result = self.vault.redact({'ok': 200 <= response.status < 300, 'status_code': response.status,
                                       'content': text, 'truncated': len(content) > MAX_BYTES,
                                       'bytes': min(len(content), MAX_BYTES)}, RESULT)
            result['truncated'] |= len(result['content']) > MAX_BYTES
            result['content'] = result['content'][:MAX_BYTES]
            return result
        except InterruptedError:
            raise
        except Exception:
            # Never expose request objects, encoded Basic auth, URLs or transport tracebacks.
            self._check()
            return {'ok': False, 'error': 'Service request failed; check verified TLS and connection availability.'}
        finally:
            finished.set()
            if watcher is not None:
                watcher.join()
            if connection is not None:
                connection.close()
