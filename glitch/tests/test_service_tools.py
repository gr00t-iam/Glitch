"""Scoped credentials: temporary vaults and synthetic transports, never live services."""
import json
import base64
import ssl
import threading
import unittest
import os
import shutil
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from glitch.tests import test_vault as fixtures
from glitch.redaction import DECISION, RESULT, RUNTIME
from glitch.tests.context_fixtures import ContextModelFixture

SYNTHETIC, ORIGIN = fixtures.SYNTHETIC, fixtures.ORIGIN

try:
    from glitch.service_tools import ServiceTools, SERVICE_SCHEMAS
except ImportError:
    ServiceTools = None
    SERVICE_SCHEMAS = []


class ServiceTests(unittest.TestCase):
    def setUp(self):
        fixtures.VaultTests.setUp(self)
        self.assertIsNotNone(ServiceTools, 'Task 2 requires scoped service tools')
        self.cancel = threading.Event()
        self.approve = Mock(return_value=True)
        self.emit = Mock()
        self.tools = ServiceTools(self.vault, self.approve, self.emit, self.cancel)
        self.item = self.save()
        self.response = Mock(status=200)
        self.response.read1.side_effect = [json.dumps({'echo': SYNTHETIC}).encode(), b'']
        self.connection = Mock()
        self.connection.getresponse.return_value = self.response
        self.transport = patch('glitch.service_tools.http.client.HTTPSConnection', return_value=self.connection)
        self.transport.start()
        self.addCleanup(self.transport.stop)

    def save(self):
        return fixtures.VaultTests.save(self)

    def request(self, **extra):
        return self.tools.execute('service_request', {
            'credential_id': self.item['id'], 'endpoint': '/api/status', 'method': 'GET'} | extra)

    def test_metadata_only(self):
        result = self.tools.execute('list_connections', {})
        self.assertEqual(result['connections'][0]['id'], self.item['id'])
        self.assertNotIn(SYNTHETIC, str(result))
        self.connection.request.assert_not_called()

    def test_exact_origin_and_host_auth_redact_response(self):
        result = self.request()
        self.assertTrue(result['ok'])
        self.assertEqual(result['status_code'], 200)
        self.assertNotIn(SYNTHETIC, str(result))
        args, kwargs = self.connection.request.call_args
        self.assertEqual(args[:2], ('GET', '/api/status'))
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + SYNTHETIC)
        self.approve.assert_not_called()

    def test_proxmox_header_is_host_constructed(self):
        self.item = self.vault.save('PVE fixture', 'proxmox', ORIGIN,
                                    {'token_id': 'fixture@pve!test', 'secret': SYNTHETIC})
        self.request()
        self.assertEqual(self.connection.request.call_args.kwargs['headers']['Authorization'],
                         'PVEAPIToken=fixture@pve!test=' + SYNTHETIC)

    def test_basic_auth_reflection_and_redaction_expansion_are_bounded(self):
        self.item = self.vault.save('Basic fixture', 'basic', ORIGIN,
                                   {'username': 'z', 'password': SYNTHETIC})
        encoded = base64.b64encode(('z:' + SYNTHETIC).encode()).decode()
        self.response.read1.side_effect = [json.dumps({'auth': 'Basic ' + encoded}).encode(), b'']
        result = self.request()
        self.assertNotIn(encoded, str(result))
        self.assertEqual(json.loads(result['content'])['auth'], '[credential removed]')
        self.response.read1.side_effect = [b'z' * 65536, b'']
        result = self.request()
        self.assertLessEqual(len(result['content']), 65536)
        self.assertTrue(result['truncated'])

    def test_cancel_waiting_for_desktop_lease(self):
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        self.tools.resources.desktop.acquire()
        self.addCleanup(self.tools.resources.desktop.release)
        timer = threading.Timer(.15, self.cancel.set)
        timer.start()
        try:
            with patch.object(self.tools.chrome, 'fill_credential') as fill:
                with self.assertRaises(InterruptedError):
                    self.tools.execute('browser_fill_credential', self.fill_args())
            fill.assert_not_called()
        finally:
            timer.join()

    def test_request_checks_cancel_after_approval(self):
        self.approve.side_effect = lambda *_: (self.cancel.set() or True)
        with self.assertRaises(InterruptedError):
            self.request(method='POST', body={})
        self.connection.request.assert_not_called()

    def test_transport_deadline_and_failure_are_closed_without_exception_text(self):
        with patch('glitch.service_tools.DEADLINE', 0):
            result = self.request()
        self.assertFalse(result['ok'])
        self.connection.request.assert_not_called()
        self.connection.close.assert_called()

    def test_engine_dispatches_and_persists_safe_service_feedback(self):
        from glitch.engine import AgentEngine
        session = self.store.new_session(self.root)
        seen = []
        class Models(ContextModelFixture):
            def chat(inner, settings, messages, cancel):
                seen.append(messages[:])
                if len(seen) == 1:
                    return {'done': False, 'message': 'Inspect fixture', 'tool': {
                        'name': 'service_request', 'args': {'credential_id': self.item['id'],
                                                         'endpoint': '/api/status', 'method': 'GET'}}}
                return {'done': True, 'message': 'Fixture done', 'tool': None}
        engine = AgentEngine(self.store, Models())
        engine.run_sync(session, 'Inspect fixture')
        self.assertEqual(len(seen), 2)
        feedback = json.loads(seen[1][-1]['content'].split('\n', 1)[1])
        self.assertEqual(feedback['tool'], 'service_request')
        self.assertTrue(feedback['ok'])
        self.assertNotIn(SYNTHETIC, str(self.store.events(session, 0)))
        self.assertNotIn(SYNTHETIC, str(self.store.messages(session)))

    def test_engine_unknown_tool_never_reaches_an_executor(self):
        from glitch.engine import AgentEngine
        session = self.store.new_session(self.root)
        decisions = iter([{'done': False, 'message': 'Fixture', 'tool': {'name': 'unknown-fixture', 'args': {}}},
                          {'done': True, 'message': 'Done', 'tool': None}])
        models = Mock()
        models.count_prompt = ContextModelFixture().count_prompt
        models.summarize = ContextModelFixture().summarize
        models.chat.side_effect = lambda *_: next(decisions)
        with patch('glitch.engine.WorkspaceTools.execute') as workspace, \
                patch('glitch.engine.ComputerTools.execute') as computer, \
                patch('glitch.engine.ServiceTools.execute') as service:
            AgentEngine(self.store, models).run_sync(session, 'Fixture')
        for executor in (workspace, computer, service):
            executor.assert_not_called()
        self.assertIn('Unknown tool', str(self.store.events(session, 0)))

    def test_standalone_engine_computer_shares_credential_desktop_lease(self):
        from glitch.engine import AgentEngine
        self.store.save_settings({'full_access': True})
        session = self.store.new_session(self.root)
        decisions = iter([{'done': False, 'message': 'Fixture', 'tool': {'name': 'browser_action', 'args': {'action': 'text'}}},
                          {'done': True, 'message': 'Done', 'tool': None}])
        models = Mock()
        models.chat.side_effect = lambda *_: next(decisions)
        def execute(inner, name, args):
            self.assertTrue(inner.approve('Browser Action', args))
            self.assertTrue(self.tools.resources.desktop.locked())
            return {'ok': True}
        models.count_prompt = ContextModelFixture().count_prompt
        models.summarize = ContextModelFixture().summarize
        with patch('glitch.engine.ComputerTools.execute', new=execute):
            AgentEngine(self.store, models).run_sync(session, 'Fixture')
        results = [e for e in self.store.events(session, 0) if e['title'] == 'browser_action' and e['kind'] == 'result']
        self.assertTrue(results, 'Computer execution must succeed under the shared desktop lease')
        self.assertFalse(self.tools.resources.desktop.locked())

    def test_browser_navigation_during_approval_is_denied_under_lease(self):
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        current = [ORIGIN + '/login']
        def approve(*_):
            current[0] = 'https://other.test/login'
            return True
        self.approve.side_effect = approve
        socket = Mock()
        def recv():
            self.assertTrue(self.tools.resources.desktop.locked())
            return json.dumps({'id': 1, 'result': {'frameTree': {'frame': {'url': current[0]}}}})
        socket.recv.side_effect = recv
        page = {'id': 'fixture-tab', 'url': ORIGIN, 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture-tab'}
        with patch.object(self.tools.chrome, 'ensure', return_value=[page]), \
                patch('websocket.create_connection', return_value=socket), patch.object(self.vault, 'resolve') as resolve:
            result = self.tools.execute('browser_fill_credential', self.fill_args())
        self.assertFalse(result['ok'])
        resolve.assert_not_called()
        self.assertEqual(socket.send.call_count, 1)
        self.assertFalse(self.tools.resources.desktop.locked())

    def test_full_access_never_skips_origin_guard(self):
        from glitch.engine import AgentEngine
        self.store.save_settings({'full_access': True})
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        engine = AgentEngine(self.store, Mock())
        engine.running_session = self.store.new_session(self.root)
        self.tools.approve = engine._approve
        with patch.object(self.tools.chrome, 'fill_credential', side_effect=ValueError('Origin changed')) as fill:
            result = self.tools.execute('browser_fill_credential', self.fill_args())
        fill.assert_called_once()
        self.assertFalse(result['ok'])

    def test_mutation_approval_before_transport_and_denial(self):
        def denied(*_):
            self.connection.request.assert_not_called()
            self.assertFalse(self.tools.resources.desktop.locked())
            return False
        self.approve.side_effect = denied
        self.assertTrue(self.request(method='POST', body={'enabled': True})['denied'])
        self.connection.request.assert_not_called()

    def test_reject_unsafe_endpoints_and_injection(self):
        for endpoint in ('https://evil.test/', '//evil.test/', '/\\evil', '/a/../b',
                         '/%2e%2e/b', '/%252e%252e/b', '/%2f%2fevil.test', '/a#frag',
                         '/a%0d%0aInjected:x', '/a/./b', 'http://example.invalid'):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                self.request(endpoint=endpoint)
        for extra in ({'headers': {'Authorization': 'custom'}}, {'method': 'CONNECT'},
                      {'method': 'TRACE'}, {'env': {}}, {'command': 'ignored'}, {'body': 'raw'},
                      {'body': {'value': float('nan')}}, {'origin': 'https://evil.test'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.request(**extra)
        self.connection.request.assert_not_called()

    def test_redirect_refusal_no_location_or_body_leak(self):
        self.response.status = 302
        result = self.request()
        self.assertFalse(result['ok'])
        self.response.read1.assert_not_called()
        self.assertNotIn(SYNTHETIC, str(result))
        self.assertEqual(self.connection.request.call_count, 1)

    def test_bounded_response(self):
        self.response.read1.side_effect = [b'x' * 65536] * 10
        result = self.request()
        self.assertTrue(result['truncated'])
        self.assertLessEqual(len(result['content']), 65536)
        self.assertLessEqual(self.response.read1.call_count, 2)
        self.connection.close.assert_called()

    def test_truncated_response_cannot_leak_credential_prefix(self):
        prefix = SYNTHETIC[:12]
        self.response.read1.side_effect = [b'q' * (65536 - len(prefix)) + SYNTHETIC.encode(), b'']
        result = self.request()
        self.assertTrue(result['truncated'])
        self.assertTrue(prefix not in result['content'], 'Response leaked a truncated credential prefix')

    def test_cancellation_before_and_during_response(self):
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            self.request()
        self.connection.request.assert_not_called()
        self.cancel.clear()
        def read(_):
            self.cancel.set()
            return b'partial'
        self.response.read1.side_effect = read
        with self.assertRaises(InterruptedError):
            self.request()
        self.connection.close.assert_called()

    def test_tls_verification_and_custom_ca(self):
        self.request()
        context = self.transport.target.HTTPSConnection.call_args.kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        import requests
        from pathlib import Path
        bundle = Path(requests.certs.where()).read_text(encoding='ascii')
        begin = bundle.index('-----BEGIN CERTIFICATE-----')
        end = bundle.index('-----END CERTIFICATE-----', begin) + len('-----END CERTIFICATE-----')
        ca = bundle[begin:end]
        self.item = self.vault.save('CA fixture', 'bearer', ORIGIN, {'token': SYNTHETIC, 'ca_pem': ca})
        self.response.read1.side_effect = [b'{}', b'']
        with patch('glitch.service_tools.ssl.create_default_context', wraps=ssl.create_default_context) as create:
            self.request()
        self.assertEqual(create.call_args.kwargs['cadata'], ca)

    def test_tls_failure_redacted_and_closed(self):
        self.connection.request.side_effect = ssl.SSLCertVerificationError(SYNTHETIC)
        result = self.request()
        self.assertFalse(result['ok'])
        self.assertNotIn(SYNTHETIC, str(result))
        self.connection.close.assert_called()

    def test_browser_kind_cannot_authenticate_service(self):
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        with self.assertRaises(ValueError):
            self.request()
        self.connection.request.assert_not_called()

    def test_browser_approval_before_lease_recheck_and_no_values(self):
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        chrome = self.tools.chrome
        def fill(args, origin, resolve):
            self.assertTrue(self.tools.resources.desktop.locked())
            self.assertEqual(origin, ORIGIN)
            self.assertEqual(resolve()['password'], SYNTHETIC)
            return {'ok': True, 'fields': ['username', 'password']}
        def approve(*_):
            self.assertFalse(self.tools.resources.desktop.locked())
            return True
        self.approve.side_effect = approve
        with patch.object(chrome, 'fill_credential', side_effect=fill) as filled:
            result = self.tools.execute('browser_fill_credential', self.fill_args())
        self.assertTrue(result['ok'])
        filled.assert_called_once()
        self.assertNotIn(SYNTHETIC, str(result))
        self.assertFalse(self.tools.resources.desktop.locked())

    def fill_args(self):
        return {'credential_id': self.item['id'], 'tab_id': 'fixture-tab',
                'username_selector': '#user', 'password_selector': '#pass'}

    def test_browser_denial_never_resolves_or_fills(self):
        self.approve.return_value = False
        self.item = self.vault.save('Browser fixture', 'browser', ORIGIN,
                                   {'username': 'fixture-user', 'password': SYNTHETIC})
        with patch.object(self.vault, 'resolve') as resolve, patch.object(self.tools.chrome, 'fill_credential') as fill:
            self.assertTrue(self.tools.execute('browser_fill_credential', self.fill_args())['denied'])
        resolve.assert_not_called()
        fill.assert_not_called()

    def test_protocol_collisions_keep_ids_enums_and_redact_untrusted_content(self):
        for value in ('service_request', 'browser_fill_credential', 'GET', 'credential_id',
                      'endpoint', 'body', 'connections', 'status_code', 'username', self.item['id']):
            self.vault.save('Collision fixture', 'basic', 'https://other.test',
                            {'username': value, 'password': SYNTHETIC})
        decision = {'done': False, 'message': SYNTHETIC, 'tool': {'name': 'service_request',
            'args': {'credential_id': self.item['id'], 'method': 'GET', 'endpoint': '/api/status',
                     'body': {'credential_id': SYNTHETIC}}}}
        safe = self.vault.redact(decision, DECISION)
        self.assertEqual(safe['tool']['name'], 'service_request')
        self.assertEqual(safe['tool']['args']['credential_id'], self.item['id'])
        self.assertEqual(safe['tool']['args']['method'], 'GET')
        self.assertNotIn(SYNTHETIC, str(safe))
        result = self.vault.redact({'ok': True, 'status_code': 200,
                                   'connections': self.vault.list(), 'content': {'body': SYNTHETIC}}, RESULT)
        self.assertEqual(result['connections'][0]['id'], self.item['id'])
        self.assertEqual(result['status_code'], 200)
        self.assertNotIn(SYNTHETIC, str(result))
        pending = {'approval': {'id': 'approval-fixture', 'action': 'service_request', 'payload': decision['tool']['args']}}
        self.assertEqual(self.vault.redact(pending, RUNTIME)['approval']['action'], 'service_request')

    def test_unknown_tool_rejected(self):
        with self.assertRaises(ValueError):
            self.tools.execute('resolve_secret', {})
        self.assertEqual({t['name'] for t in SERVICE_SCHEMAS},
                         {'list_connections', 'service_request', 'browser_fill_credential'})


class BrowserOriginTests(unittest.TestCase):
    def test_cdp_origin_recheck_blocks_navigation_before_resolving(self):
        from glitch.computer import ChromeController
        chrome = ChromeController('unused-fixture', threading.Event())
        self.assertTrue(hasattr(chrome, 'fill_credential'), 'Task 2 needs trusted CDP fill')
        args = {'tab_id': 'fixture-tab', 'username_selector': '#user', 'password_selector': '#pass'}
        page = {'id': 'fixture-tab', 'url': ORIGIN, 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture-tab'}
        socket = Mock()
        socket.recv.return_value = json.dumps({'id': 1, 'result': {'frameTree': {'frame': {'url': 'https://evil.test/login'}}}})
        resolve = Mock()
        with patch.object(chrome, 'ensure', return_value=[page]), patch('websocket.create_connection', return_value=socket):
            with self.assertRaises(ValueError):
                chrome.fill_credential(args, ORIGIN, resolve)
        resolve.assert_not_called()
        socket.close.assert_called()

    def test_cdp_atomic_fill_checks_origin_and_returns_only_field_ids(self):
        from glitch.computer import ChromeController
        chrome = ChromeController('unused-fixture', threading.Event())
        self.assertTrue(hasattr(chrome, 'fill_credential'), 'Task 2 needs trusted CDP fill')
        args = {'tab_id': 'fixture-tab', 'username_selector': '#user', 'password_selector': '#pass'}
        page = {'id': 'fixture-tab', 'url': ORIGIN, 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture-tab'}
        socket = Mock()
        socket.recv.side_effect = [json.dumps({'id': 1, 'result': {'frameTree': {'frame': {'url': ORIGIN + '/login'}}}}),
                                  json.dumps({'id': 2, 'result': {'result': {'value': True}}})]
        with patch.object(chrome, 'ensure', return_value=[page]), patch('websocket.create_connection', return_value=socket):
            result = chrome.fill_credential(args, ORIGIN, lambda: {'username': 'fixture-user', 'password': SYNTHETIC})
        expression = json.loads(socket.send.call_args.args[0])['params']['expression']
        self.assertIn('location.origin', expression)
        self.assertLess(expression.index('location.origin'), expression.index(SYNTHETIC))
        self.assertEqual(result, {'ok': True, 'fields': ['username', 'password']})
        self.assertNotIn(SYNTHETIC, str(result))

    def test_wrong_scheme_port_and_host_refused_before_resolution(self):
        from glitch.computer import ChromeController
        chrome = ChromeController('unused-fixture', threading.Event())
        args = {'tab_id': 'fixture-tab', 'username_selector': '#user', 'password_selector': '#pass'}
        page = {'id': 'fixture-tab', 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture-tab'}
        for url in ('http://example.invalid:8443/login', 'https://example.invalid:8444/login',
                    'https://example.invalid.evil.test:8443/login', 'https://user@example.invalid:8443/login'):
            socket = Mock()
            socket.recv.return_value = json.dumps({'id': 1, 'result': {'frameTree': {'frame': {'url': url}}}})
            resolve = Mock()
            with self.subTest(url=url), patch.object(chrome, 'ensure', return_value=[page]), \
                    patch('websocket.create_connection', return_value=socket):
                with self.assertRaises(ValueError):
                    chrome.fill_credential(args, ORIGIN, resolve)
            resolve.assert_not_called()

    def test_navigation_between_cdp_calls_fails_without_returning_dom_or_values(self):
        from glitch.computer import ChromeController
        chrome = ChromeController('unused-fixture', threading.Event())
        args = {'tab_id': 'fixture-tab', 'username_selector': '#user', 'password_selector': '#pass'}
        page = {'id': 'fixture-tab', 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/fixture-tab'}
        socket = Mock()
        socket.recv.side_effect = [json.dumps({'id': 1, 'result': {'frameTree': {'frame': {'url': ORIGIN}}}}),
                                  json.dumps({'id': 2, 'result': {'exceptionDetails': {'text': SYNTHETIC}}})]
        with patch.object(chrome, 'ensure', return_value=[page]), patch('websocket.create_connection', return_value=socket):
            with self.assertRaises(ValueError) as error:
                chrome.fill_credential(args, ORIGIN, lambda: {'username': 'fixture-user', 'password': SYNTHETIC})
        self.assertNotIn(SYNTHETIC, str(error.exception))
        socket.close.assert_called()


class LoopbackTlsTests(unittest.TestCase):
    """Real HTTPS, self-signed temporary CA, no ambient network or user database."""
    def setUp(self):
        fixtures.VaultTests.setUp(self)
        openssl = shutil.which('openssl') or str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/usr/bin/openssl.exe')
        if not Path(openssl).is_file():
            self.skipTest('Temporary TLS certificate generator (OpenSSL) unavailable')
        cert, key = self.root / 'cert.pem', self.root / 'key.pem'
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=Glitch temporary TLS fixture', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True, timeout=10)
        self.received = []
        received = self.received
        class Handler(BaseHTTPRequestHandler):
            def log_message(inner, *_):
                pass
            def do_GET(inner):
                received.append((inner.path, inner.headers.get('Authorization')))
                if inner.path == '/slow-headers':
                    try:
                        for line in (b'HTTP/1.0 200 OK\r\n', b'Content-Length: 2\r\n', b'\r\n', b'{}'):
                            inner.wfile.write(line)
                            inner.wfile.flush()
                            time.sleep(.3)
                    except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                        pass
                    return
                body = json.dumps({'echo': SYNTHETIC}).encode()
                if inner.path == '/large':
                    body = b'q' * 131072
                inner.send_response(302 if inner.path == '/redirect' else 200)
                if inner.path == '/redirect':
                    inner.send_header('Location', '/echo')
                inner.send_header('Content-Length', str(len(body)))
                inner.end_headers()
                if inner.path == '/slow':
                    time.sleep(.4)
                try:
                    inner.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                    pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.addCleanup(self.close_server)
        self.origin = 'https://127.0.0.1:' + str(self.server.server_port)
        self.ca = cert.read_text(encoding='ascii')
        self.item = self.vault.save('Loopback fixture', 'bearer', self.origin,
                                   {'token': SYNTHETIC, 'ca_pem': self.ca})
        self.cancel = threading.Event()
        self.tools = ServiceTools(self.vault, Mock(return_value=True), Mock(), self.cancel)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(3)

    def request(self, endpoint='/echo'):
        return self.tools.execute('service_request', {'credential_id': self.item['id'],
                                                      'endpoint': endpoint, 'method': 'GET'})

    def test_ca_trust_and_exact_request(self):
        result = self.request()
        self.assertTrue(result['ok'])
        self.assertEqual(self.received, [('/echo', 'Bearer ' + SYNTHETIC)])
        self.assertNotIn(SYNTHETIC, str(result))

    def test_untrusted_ca_fails_before_http_auth(self):
        self.item = self.vault.save('Untrusted loopback', 'bearer', self.origin, {'token': SYNTHETIC})
        self.assertFalse(self.request()['ok'])
        self.assertEqual(self.received, [])

    def test_redirect_is_not_followed_and_large_response_is_bounded(self):
        self.assertFalse(self.request('/redirect')['ok'])
        self.assertEqual([item[0] for item in self.received], ['/redirect'])
        result = self.request('/large')
        self.assertTrue(result['truncated'])
        self.assertEqual(result['content'], '')

    def test_cancel_during_real_response(self):
        timer = threading.Timer(.15, self.cancel.set)
        timer.start()
        try:
            with self.assertRaises(InterruptedError):
                self.request('/slow')
        finally:
            timer.join()

    def test_real_read_timeout_and_deadline(self):
        with patch('glitch.service_tools.TIMEOUT', .1):
            self.assertFalse(self.request('/slow')['ok'])
        with patch('glitch.service_tools.DEADLINE', .05):
            self.assertFalse(self.request('/slow')['ok'])

    def test_deadline_interrupts_slow_drip_headers(self):
        started = time.monotonic()
        with patch('glitch.service_tools.DEADLINE', .15):
            self.assertFalse(self.request('/slow-headers')['ok'])
        self.assertLess(time.monotonic() - started, .6)

    def test_cancellation_interrupts_headers(self):
        timer = threading.Timer(.15, self.cancel.set)
        started = time.monotonic()
        timer.start()
        try:
            with self.assertRaises(InterruptedError):
                self.request('/slow-headers')
            self.assertLess(time.monotonic() - started, .6)
        finally:
            timer.join()


if __name__ == '__main__':
    unittest.main()
