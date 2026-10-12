"""Task 6: real temporary Dulwich repositories, synthetic vault, no public network."""
import copy
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from dulwich.client import LocalGitClient
from dulwich.config import StackedConfig
from dulwich.repo import Repo
from dulwich.object_store import iter_tree_contents
from glitch.api import DesktopAPI
from glitch.engine import AgentEngine
from glitch.tests.context_fixtures import ContextModelFixture
from glitch.github_service import GitHubService
from glitch.resources import ResourceCoordinator
from glitch.storage import Store
from glitch.tests import test_vault as fixtures
from glitch.tests import test_github_service as backend

try:
    from glitch.github_tools import GitHubTools, GITHUB_SCHEMAS
except ImportError:
    GitHubTools = None
    GITHUB_SCHEMAS = []


class PublishingTests(unittest.TestCase):
    def setUp(self):
        fixtures.VaultTests.setUp(self)
        self.assertIsNotNone(GitHubTools, 'Task 6 publishing tools are missing')
        self.item = self.vault.save('Fixture', 'github', 'https://github.com', {'token': fixtures.SYNTHETIC})
        self.workspace = self.root / 'checkout'
        self.workspace.mkdir()
        self.remote = self.root / 'remote'
        self.remote.mkdir()
        with Repo.init(self.remote, config=StackedConfig([])) as repo:
            backend.GitHubTests.commit(repo, {'hello.txt': b'hello\n'})
        self.cancel = threading.Event()
        self.http = Mock(side_effect=self.response)
        self.transport = LocalGitClient()
        self.pushes = 0
        self.lose_push = False
        self.offline = False
        self.protected = False
        self.pull = None
        self.posts = 0
        self.service = GitHubService(self.vault, http=self.http, git_factory=self.client)
        self.service.resources = ResourceCoordinator()
        self.workspace.rmdir()
        self.service.clone(self.item['id'], 'fixture', 'sample', self.root, 'checkout', self.cancel)
        self.session = self.store.new_session(self.workspace)
        self.store.save_settings({'github_author_name': 'Fixture', 'github_author_email': 'fixture@example.invalid'})
        self.service.bind(self.workspace, self.item['id'], 'fixture', 'sample', self.cancel)
        self.previews = []
        self.approve = Mock(side_effect=self.allow)
        self.tools = GitHubTools(self.service, self.workspace, self.approve, Mock(), self.cancel)

    def response(self, endpoint, payload, cancel, deadline, body=None):
        if endpoint == '/user':
            return 200, {}, {'login': 'fixture', 'id': 42}
        if endpoint == '/repos/fixture/sample':
            return 200, {}, backend.GitHubTests.repository()
        if '/branches/' in endpoint:
            return 200, {}, {'protected': self.protected}
        if '/pulls?' in endpoint:
            return 200, {}, [self.pull] if self.pull else []
        if endpoint.endswith('/pulls') and body:
            self.posts += 1
            with Repo(self.remote) as repo:
                head = repo.refs[('refs/heads/' + body['head']).encode()].decode()
                base = repo.refs[('refs/heads/' + body['base']).encode()].decode()
            self.pull = {'id': 700, 'number': 7, 'state': 'open', 'html_url': 'https://github.com/fixture/sample/pull/7',
                         'head': {'ref': body['head'], 'sha': head, 'repo': {'full_name': 'fixture/sample'}},
                         'base': {'ref': body['base'], 'sha': base, 'repo': {'full_name': 'fixture/sample'}}}
            raise OSError('synthetic lost PR response ' + fixtures.SYNTHETIC)
        raise AssertionError('Unexpected fixture route')

    def client(self, url, payload, cancel, deadline):
        fixture = self
        class Client:
            def fetch(self, _, target, **kwargs):
                return fixture.transport.fetch(str(fixture.remote), target, **kwargs)
            def get_refs(self, _, **kwargs):
                return fixture.transport.get_refs(str(fixture.remote), **kwargs)
            def send_pack(self, _, update_refs, generate_pack_data, **kwargs):
                fixture.pushes += 1
                if fixture.offline:
                    raise OSError(fixtures.SYNTHETIC)
                result = fixture.transport.send_pack(str(fixture.remote), update_refs, generate_pack_data, **kwargs)
                if fixture.lose_push:
                    raise OSError('lost response ' + fixtures.SYNTHETIC)
                return result
            def close(self):
                pass
        return Client()

    def allow(self, action, preview):
        self.previews.append(copy.deepcopy(preview))
        return True

    def branch(self, name='feature/work'):
        result = self.tools.execute('github_create_branch', {'branch': name})
        self.assertTrue(result['ok'], result)

    def edit(self, name='hello.txt', data=b'changed\n'):
        (self.workspace / name).write_bytes(data)

    def publish(self, **kwargs):
        return self.tools.execute('github_commit_and_push',
            {'paths': ['hello.txt'], 'branch': 'feature/work', 'title': 'Fixture change', 'body': ''} | kwargs)

    def test_eight_schemas_and_unknown_destructive_options(self):
        self.assertEqual({s['name'] for s in GITHUB_SCHEMAS}, {
            'github_list_repositories', 'github_clone_repo', 'github_repo_status', 'github_diff',
            'github_create_branch', 'github_pull', 'github_commit_and_push', 'github_create_pull_request'})
        for name in ['github_reset', 'github_delete_branch', 'github_merge', 'github_force_push']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.tools.execute(name, {})
        with self.assertRaises(ValueError):
            self.publish(force=True)

    def test_explicit_paths_only_and_real_remote_commit(self):
        self.branch()
        self.edit()
        self.edit('unreviewed.txt', b'not selected\n')
        result = self.publish()
        self.assertTrue(result['ok'], result)
        with Repo(self.remote) as repo:
            commit = repo[repo.refs[b'refs/heads/feature/work']]
            self.assertEqual([e.path for e in iter_tree_contents(repo.object_store, commit.tree)], [b'hello.txt'])
        self.assertEqual(self.service.status(self.workspace)['untracked'], ['unreviewed.txt'])
        self.assertIn('changed', self.previews[-1]['diff'])
        self.assertEqual(self.previews[-1]['paths'], ['hello.txt'])
        self.assertIn('fingerprint', self.previews[-1])

    def test_unsafe_default_and_protected_branches(self):
        for name in ['-option', '../escape', 'main', 'HEAD', 'refs/heads/x', 'a.lock']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.tools.execute('github_create_branch', {'branch': name})
        self.branch()
        self.edit()
        self.protected = True
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_preexisting_staged_changes_are_refused(self):
        self.branch()
        self.edit()
        with Repo(self.workspace) as repo:
            repo.get_worktree().stage(['hello.txt'])
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_secret_and_protected_path_refusal(self):
        self.branch()
        for name, data in [('hello.txt', fixtures.SYNTHETIC.encode()), ('.env', b'harmless'),
                           ('credentials.json', b'{}'), ('key.pem', b'harmless'),
                           ('hello.txt', b'-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----')]:
            with self.subTest(name=name):
                self.edit(name, data)
                with self.assertRaises(ValueError) as error:
                    self.publish(paths=[name])
                self.assertNotIn(fixtures.SYNTHETIC, str(error.exception))
        self.assertEqual(self.pushes, 0)

    def test_remote_mismatch_and_unsafe_config_refused(self):
        self.branch()
        self.edit()
        for section, key, value in [((b'remote', b'origin'), b'url', b'https://github.com/other/sample.git'),
                                    ((b'filter', b'evil'), b'clean', b'program')]:
            with self.subTest(key=key):
                config = self.workspace / '.git/config'
                saved = config.read_bytes()
                with Repo(self.workspace) as repo:
                    settings = repo.get_config()
                    settings.set(section, key, value)
                    settings.write_to_path()
                with self.assertRaises(ValueError):
                    self.publish()
                config.write_bytes(saved)

    def test_approval_releases_lease_and_rechecks_exact_file_bytes(self):
        self.branch()
        self.edit()
        def changed(action, preview):
            key = next(iter(self.service.resources.workspaces))
            lock = self.service.resources.workspaces[key]
            self.assertTrue(lock.acquire(blocking=False), 'Lease held during human approval')
            lock.release()
            self.edit(data=b'raced bytes\n')
            return True
        self.approve.side_effect = changed
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_approval_rechecks_index_head_remote_and_binding(self):
        for changed in ['index', 'head', 'remote', 'binding']:
            with self.subTest(changed=changed):
                self.branch('feature/' + changed)
                self.edit(data=changed.encode())
                def race(action, preview):
                    if changed == 'index':
                        with Repo(self.workspace) as repo:
                            repo.get_worktree().stage(['hello.txt'])
                    elif changed == 'head':
                        (self.workspace / '.git/HEAD').write_bytes(b'ref: refs/heads/main\n')
                    elif changed == 'remote':
                        with Repo(self.remote) as repo:
                            backend.GitHubTests.commit(repo, {'hello.txt': b'remote changed'})
                    else:
                        with self.store.connect() as db:
                            db.execute("UPDATE github_connections SET default_branch='other'")
                    return True
                self.approve.side_effect = race
                with self.assertRaises(ValueError):
                    self.publish(branch='feature/' + changed)
                self.assertEqual(self.pushes, 0)
                # Restore fixture state for the next independent race.
                self.approve.side_effect = self.allow
                with Repo(self.workspace) as repo:
                    repo.refs.set_symbolic_ref(b'HEAD', b'refs/heads/main')
                    self.edit(data=b'hello\n')
                    repo.get_worktree().stage(['hello.txt'])
                with self.store.connect() as db:
                    db.execute("UPDATE github_connections SET default_branch='main'")

    def test_lost_push_response_reconciles_sha_without_duplicate_commit(self):
        self.branch()
        self.edit()
        self.lose_push = True
        result = self.publish()
        self.assertTrue(result['ok'], result)
        head = self.service.status(self.workspace)['head']
        self.assertTrue(self.publish()['ok'])
        self.assertEqual(self.service.status(self.workspace)['head'], head)
        self.assertEqual(self.pushes, 1)

    def test_failed_push_retains_local_commit_and_retry_does_not_duplicate(self):
        self.branch()
        self.edit()
        self.offline = True
        result = self.publish()
        self.assertFalse(result['ok'])
        self.assertTrue(result['local_commit_retained'])
        head = self.service.status(self.workspace)['head']
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(result))
        self.offline = False
        self.assertTrue(self.publish()['ok'])
        self.assertEqual(head, self.service.status(self.workspace)['head'])

    def test_pr_lost_response_searches_matching_head_base(self):
        self.branch()
        self.edit()
        self.publish()
        args = {'head': 'feature/work', 'base': 'main', 'title': 'Fixture PR', 'body': ''}
        result = self.tools.execute('github_create_pull_request', args)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['number'], 7)
        self.assertTrue(self.tools.execute('github_create_pull_request', args)['ok'])
        self.assertEqual(self.posts, 1)

    def test_denial_cancellation_and_schema_limits_never_mutate(self):
        self.approve.return_value = False
        self.approve.side_effect = None
        self.assertTrue(self.tools.execute('github_create_branch', {'branch': 'feature/no'})['denied'])
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            self.tools.execute('github_repo_status', {})
        self.cancel.clear()
        for args in [{'branch': 42}, {'branch': 'x' * 300}]:
            with self.assertRaises(ValueError):
                self.tools.execute('github_create_branch', args)

    def test_connection_persists_only_metadata_and_cannot_be_model_rebound(self):
        connection = self.store.github_connection(self.workspace)
        self.assertEqual(connection['credential_id'], self.item['id'])
        self.assertEqual(connection['default_branch'], 'main')
        reopened = Store(self.store.directory)
        self.assertEqual(reopened.github_connection(self.workspace), connection)
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(connection))
        with self.assertRaises(ValueError):
            self.tools.execute('github_repo_status', {'credential_id': 'model-supplied'})

    def test_shared_git_identity_matches_file_and_shell_resources(self):
        coordinator = self.service.resources
        coordinator.acquire('GitHub mutation', str(self.workspace), self.cancel)
        self.assertIs(coordinator.local.held, coordinator.workspaces[
            __import__('os').path.normcase(__import__('os').path.realpath(self.workspace))])
        coordinator.release()

    def test_diff_redacts_complete_multiline_source_before_segmentation(self):
        value = 'source-line-one\nsource-line-two'
        with patch('glitch.storage.protect', side_effect=fixtures.fixture_cipher):
            self.store.save_settings({'supervisor_key': value})
            self.edit(data=('prefix\n' + value + '\nsuffix\n').encode())
            result = self.tools.execute('github_diff', {'paths': ['hello.txt']})
        self.assertNotIn('source-line-one', result['diff'])
        self.assertNotIn('source-line-two', result['diff'])

    def test_parent_and_child_dispatch_and_typed_redaction_collisions(self):
        self.vault.save('Protocol collisions', 'bearer', 'https://example.invalid', {'token': 'github_repo_status'})
        self.vault.save('Field collision', 'bearer', 'https://example.invalid', {'token': 'staged'})
        fixture = self
        class Models(ContextModelFixture):
            def __init__(self):
                self.calls = 0
                self.system = ''
            def chat(self, settings, messages, cancel):
                self.calls += 1
                self.system = messages[0]['content']
                if self.calls == 1:
                    return {'done': False, 'message': '', 'tool': {'name': 'github_repo_status', 'args': {}}}
                return {'done': True, 'message': 'Fixture complete', 'tool': None}
        for parent in (None, 'fixture-parent'):
            with self.subTest(parent=parent), patch('glitch.engine.GitHubService', return_value=fixture.service):
                models = Models()
                engine = AgentEngine(self.store, models, parent_id=parent)
                engine.run_sync(self.session, 'Inspect the fixture checkout')
                self.assertIn('github_commit_and_push', models.system)
                results = [e for e in self.store.events(self.session, 0) if e['title'] == 'github_repo_status' and e['kind'] == 'result']
                self.assertTrue(results)
                self.assertTrue(results[-1]['payload']['result']['ok'])
                self.assertIn('staged', results[-1]['payload']['result'])

    def test_full_access_still_requires_genuine_publishing_approval(self):
        self.store.save_settings({'full_access': True})
        engine = AgentEngine(self.store, Mock())
        engine.running_session = self.session
        def human_wait(timeout):
            self.assertIsNotNone(engine.pending)
            engine.resolve_approval(engine.pending['id'], True)
            return True
        with patch.object(engine.approval_event, 'wait', side_effect=human_wait):
            self.assertTrue(engine._approve('github_commit_and_push', {'repository': 'fixture/sample'}))
        events = self.store.events(self.session, 0)
        self.assertTrue(any(e['kind'] == 'approval' for e in events))
        self.assertFalse(any(e['payload'].get('automatic') for e in events))

    def test_native_bind_requires_confirmation_and_idle_admission(self):
        engine = AgentEngine(self.store, Mock())
        api = DesktopAPI(self.store, engine, Mock())
        api._github = self.service
        with self.assertRaises(ValueError):
            api.github_bind(self.session, self.item['id'], 'fixture', 'sample', False)
        self.assertTrue(api.github_bind(self.session, self.item['id'], 'fixture', 'sample', True)['ok'])
        engine.running_session = self.session
        with self.assertRaises(ValueError):
            api.github_bind(self.session, self.item['id'], 'fixture', 'sample', True)

    def test_clone_tool_and_persistent_child_binding(self):
        result = self.tools.execute('github_clone_repo', {'folder': 'child'})
        self.assertTrue(result['ok'], result)
        self.assertEqual(Path(result['workspace']), self.workspace / 'child')
        self.assertEqual(self.store.github_connection(result['workspace'])['credential_id'], self.item['id'])

    def test_cancel_during_approval_and_resource_wait(self):
        self.approve.side_effect = lambda *args: (self.cancel.set() or True)
        with self.assertRaises(InterruptedError):
            self.tools.execute('github_create_branch', {'branch': 'feature/stopped'})
        self.cancel.clear()
        lock = next(iter(self.service.resources.workspaces.values()))
        owned, release = threading.Event(), threading.Event()
        def holder():
            lock.acquire()
            owned.set()
            try:
                release.wait(3)
            finally:
                lock.release()
        worker = threading.Thread(target=holder)
        worker.start()
        self.assertTrue(owned.wait(1))
        timer = threading.Timer(.1, self.cancel.set)
        timer.start()
        try:
            with self.assertRaises(InterruptedError):
                self.tools.execute('github_repo_status', {})
        finally:
            release.set()
            worker.join(2)
            timer.join()
        self.assertFalse(worker.is_alive())

    def test_source_approval_cap_and_secret_scan_have_no_override(self):
        self.branch()
        self.edit(data=b'x' * 70000)
        with self.assertRaises(ValueError):
            self.publish()
        self.edit(data=b'public\n')
        self.store.save_settings({'full_access': True})
        self.edit(data=fixtures.SYNTHETIC.encode())
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_native_http_post_fixed_host_and_redirect_refusal(self):
        from glitch.github_service import NativeHTTP, NativeGitClient
        response = Mock(status=201, headers={}, read=Mock(side_effect=[b'{"number":7}', b'']))
        with patch('glitch.github_service._Response', return_value=response) as transport:
            result = NativeHTTP()('/repos/fixture/sample/pulls', {'token': fixtures.SYNTHETIC}, self.cancel, float('inf'),
                                  body={'title': 'Fixture', 'head': 'feature/work', 'base': 'main'})
            self.assertEqual(result[0], 201)
            self.assertEqual(transport.call_args.args[0], 'api.github.com')
        client = NativeGitClient('https://github.com/fixture/sample.git', {'token': fixtures.SYNTHETIC}, self.cancel, float('inf'), allow_push=True)
        response = Mock(status=200, content_type='application/x-git-receive-pack-result')
        with patch('glitch.github_service._Response', return_value=response) as transport:
            client._http_request(client.url + '/git-receive-pack', data=iter([b'a', b'b']))
            self.assertEqual(transport.call_args.args[0], 'github.com')
            self.assertEqual(transport.call_args.args[6], b'ab')
        for url in ['https://evil.test/git-receive-pack', client.url + '/git-receive-pack?token=x']:
            with self.assertRaises(ValueError):
                client._http_request(url, data=b'pack')

    def test_network_denials_and_protection_changes_after_approval(self):
        self.branch()
        self.edit()
        self.approve.side_effect = lambda *args: (setattr(self, 'protected', True) or True)
        with self.assertRaises(ValueError):
            self.publish()
        self.protected = False
        self.approve.side_effect = self.allow
        self.http.side_effect = lambda *args, **kwargs: (429, {'Retry-After': '9'}, None)
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_changed_selected_file_after_failed_push_refuses_new_commit(self):
        self.branch()
        self.edit()
        self.offline = True
        self.assertFalse(self.publish()['ok'])
        head = self.service.status(self.workspace)['head']
        self.edit(data=b'new edit before retry\n')
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(head, self.service.status(self.workspace)['head'])

    def test_repository_review_ui_has_bound_project_and_exact_review_fields(self):
        directory = Path(__file__).resolve().parents[1] / 'ui'
        html = (directory / 'index.html').read_text('utf-8')
        javascript = (directory / 'app.js').read_text('utf-8')
        for identifier in ('github-bind', 'github-review-paths', 'github-review-diff',
                           'repository-review', 'review-repository', 'review-branch', 'review-fingerprint', 'review-diff'):
            self.assertIn('id="' + identifier + '"', html)
        self.assertIn("call('github_bind',state.session", javascript)
        self.assertIn("call('github_review',state.session", javascript)
        self.assertIn("$('review-diff').textContent", javascript)

    def test_model_visible_publication_results_preserve_protocol_keys(self):
        from glitch.redaction import RESULT, DECISION
        for value in ('github_commit_and_push', 'head', 'local_commit_retained', 'paths'):
            self.vault.save('Collision fixture', 'bearer', 'https://example.invalid', {'token': value})
        decision = {'done': False, 'message': fixtures.SYNTHETIC,
            'tool': {'name': 'github_commit_and_push', 'args': {
                'paths': ['hello.txt'], 'branch': 'feature/work', 'title': 'Fixture', 'body': ''}}}
        safe = self.store.redact(decision, DECISION)
        self.assertEqual(safe['tool']['name'], 'github_commit_and_push')
        self.assertIn('paths', safe['tool']['args'])
        result = self.store.redact({'ok': False, 'head': 'a' * 40, 'local_commit_retained': True,
                                  'error': fixtures.SYNTHETIC}, RESULT)
        self.assertTrue(result['local_commit_retained'])
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(result))

    def test_secret_filename_and_commit_identity_are_scanned(self):
        self.branch()
        name = fixtures.SYNTHETIC + '.txt'
        self.edit(name, b'public')
        with self.assertRaises(ValueError):
            self.publish(paths=[name])
        self.assertEqual(self.pushes, 0)

    def test_sibling_file_write_waits_until_publish_lease_is_released(self):
        from glitch.tools import WorkspaceTools
        self.branch()
        self.edit()
        entered, release, written = threading.Event(), threading.Event(), threading.Event()
        original = self.client
        def client(*args):
            value = original(*args)
            send = value.send_pack
            def paused(*args, **kwargs):
                entered.set()
                if not release.wait(3):
                    raise AssertionError('Fixture timeout')
                return send(*args, **kwargs)
            value.send_pack = paused
            return value
        self.service.git_factory = client
        results = []
        worker = threading.Thread(target=lambda: results.append(self.publish()))
        def approved(action, preview):
            self.service.resources.acquire(action, self.workspace, self.cancel)
            return True
        writer = WorkspaceTools(self.workspace, approved, Mock(), self.cancel)
        def write():
            try:
                writer.execute('write_file', {'path': 'sibling.txt', 'content': 'sibling bytes'})
                written.set()
            finally:
                self.service.resources.release()
        sibling = threading.Thread(target=write)
        worker.start()
        try:
            self.assertTrue(entered.wait(3))
            sibling.start()
            self.assertFalse(written.wait(.15))
        finally:
            release.set()
            worker.join(4)
            if sibling.ident:
                sibling.join(4)
        self.assertFalse(worker.is_alive())
        self.assertTrue(written.is_set())
        self.assertTrue(results[0]['ok'], results)

    def test_retry_receipt_survives_store_and_service_restart(self):
        self.branch()
        self.edit()
        self.offline = True
        self.assertFalse(self.publish()['ok'])
        head = self.service.status(self.workspace)['head']
        reopened = Store(self.store.directory)
        reopened._vault = fixtures.Vault(reopened, cipher=fixtures.fixture_cipher)
        service = GitHubService(reopened.vault, http=self.http, git_factory=self.client)
        tools = GitHubTools(service, self.workspace, self.approve, Mock(), self.cancel)
        self.offline = False
        result = tools.execute('github_commit_and_push', {'paths': ['hello.txt'], 'branch': 'feature/work',
                                                        'title': 'Fixture change', 'body': ''})
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['head'], head)

    def test_native_dulwich_push_over_loopback_verified_tls(self):
        import base64
        import http.client
        import shutil
        import ssl
        import subprocess
        from socketserver import ThreadingMixIn
        from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server
        from dulwich.server import DictBackend
        from dulwich.web import make_wsgi_chain
        from glitch.github_service import NativeGitClient, SafeRepo
        openssl = shutil.which('openssl') or 'C:/Program Files/Git/usr/bin/openssl.exe'
        if not Path(openssl).is_file():
            self.skipTest('Loopback TLS fixture requires OpenSSL, not a product dependency')
        cert, key = self.root / 'cert.pem', self.root / 'key.pem'
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=Glitch fixture', '-addext', 'subjectAltName=IP:127.0.0.1',
            '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True, timeout=10)
        with SafeRepo(self.remote) as remote:
            class Server(ThreadingMixIn, WSGIServer):
                daemon_threads = True
            class Handler(WSGIRequestHandler):
                def log_message(self, *_):
                    pass
            app = make_wsgi_chain(DictBackend({'/fixture/sample.git': remote}))
            calls = []
            def record(environ, start_response):
                calls.append((environ['PATH_INFO'], environ.get('QUERY_STRING'), environ.get('HTTP_AUTHORIZATION')))
                return app(environ, start_response)
            server = make_server('127.0.0.1', 0, record, server_class=Server, handler_class=Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            original = http.client.HTTPSConnection
            def connection(host, **kwargs):
                self.assertEqual(host, 'github.com')
                return original('127.0.0.1', server.server_port, **kwargs)
            self.vault.save('Fixture', 'github', 'https://github.com',
                {'token': fixtures.SYNTHETIC, 'ca_pem': cert.read_text('ascii')}, self.item['id'])
            self.service.bind(self.workspace, self.item['id'], 'fixture', 'sample', self.cancel)
            self.service.git_factory = NativeGitClient
            try:
                with patch('glitch.github_service.HTTPSConnection', side_effect=connection), \
                        patch('subprocess.Popen', side_effect=AssertionError('Product cannot launch Git')), \
                        patch.object(StackedConfig, 'default_backends', side_effect=AssertionError('No global config')):
                    self.branch()
                    self.edit()
                    result = self.publish()
                self.assertTrue(result['ok'], result)
                self.assertEqual(remote.refs[b'refs/heads/feature/work'].decode(), result['head'])
                self.assertTrue(any(c[0].endswith('/git-receive-pack') for c in calls))
                expected = 'Basic ' + base64.b64encode(('x-access-token:' + fixtures.SYNTHETIC).encode()).decode()
                self.assertTrue(all(c[2] == expected for c in calls))
                for path in (self.workspace / '.git').rglob('*'):
                    if path.is_file():
                        self.assertNotIn(fixtures.SYNTHETIC.encode(), path.read_bytes())
            finally:
                server.shutdown()
                server.server_close()
                worker.join(3)

    def advance_remote(self, value, parent=None):
        from dulwich.objects import Blob, Tree, Commit
        with Repo(self.remote) as repo:
            old = parent or repo.refs[b'refs/heads/feature/work']
            blob = Blob.from_string(value)
            tree = Tree()
            tree.add(b'hello.txt', 0o100644, blob.id)
            commit = Commit()
            commit.tree = tree.id
            commit.parents = [old]
            commit.author = commit.committer = b'Fixture <fixture@example.invalid>'
            commit.author_time = commit.commit_time = 2
            commit.author_timezone = commit.commit_timezone = 0
            commit.message = b'Remote fixture\n'
            repo.object_store.add_objects([(blob, None), (tree, None), (commit, None)])
            repo.refs[b'refs/heads/feature/work'] = commit.id
            return commit.id.decode()

    def test_existing_feature_branch_updates_fast_forward_only_after_review(self):
        self.branch()
        self.edit()
        self.publish()
        incoming = self.advance_remote(b'updated remotely\n')
        result = self.tools.execute('github_create_branch', {'branch': 'feature/work'})
        self.assertTrue(result['ok'], result)
        self.assertEqual(self.service.status(self.workspace)['head'], incoming)
        self.assertEqual((self.workspace / 'hello.txt').read_bytes(), b'updated remotely\n')
        self.assertIn('updated remotely', self.previews[-1]['diff'])
        self.assertEqual(self.service.status(self.workspace)['staged'], {'add': [], 'delete': [], 'modify': []})

    def test_feature_fast_forward_refuses_divergence_and_dirty_worktree(self):
        self.branch()
        self.edit()
        published = self.publish()['head']
        self.advance_remote(b'incoming\n')
        self.edit(data=b'dirty bytes\n')
        with self.assertRaises(ValueError):
            self.tools.execute('github_create_branch', {'branch': 'feature/work'})
        self.edit(data=b'changed\n')
        # Create a remote sibling of the published commit, not a fast-forward.
        with Repo(self.remote) as repo:
            baseline = repo[published.encode()].parents[0]
        self.advance_remote(b'remote divergent\n', parent=baseline)
        local = self.service.status(self.workspace)['head']
        with self.assertRaises(ValueError):
            self.tools.execute('github_create_branch', {'branch': 'feature/work'})
        self.assertEqual(self.service.status(self.workspace)['head'], local)
        self.assertEqual(local, published)

    def test_same_timestamp_credential_replacement_invalidates_binding(self):
        with self.store.connect() as db:
            timestamp = db.execute('SELECT updated_at FROM vault WHERE id=?', (self.item['id'],)).fetchone()[0]
        self.vault.save('Fixture', 'github', 'https://github.com', {'token': 'synthetic-new-ONLY'}, self.item['id'])
        with self.store.connect() as db:
            db.execute('UPDATE vault SET updated_at=? WHERE id=?', (timestamp, self.item['id']))
        with self.assertRaises(ValueError):
            self.tools.execute('github_repo_status', {})

    def test_retained_commit_retry_displays_original_diff_and_message(self):
        self.branch()
        self.edit()
        self.offline = True
        self.assertFalse(self.publish()['ok'])
        self.assertFalse(self.publish()['ok'])
        self.assertIn('-hello', self.previews[-1]['diff'])
        self.assertIn('+changed', self.previews[-1]['diff'])
        self.assertEqual(self.previews[-1]['title'], 'Fixture change')

    def test_same_repository_rebinding_preserves_retry_receipt(self):
        self.branch()
        self.edit()
        self.offline = True
        self.assertFalse(self.publish()['ok'])
        head = self.service.status(self.workspace)['head']
        self.service.bind(self.workspace, self.item['id'], 'fixture', 'sample', self.cancel)
        self.offline = False
        self.assertTrue(self.publish()['ok'])
        self.assertEqual(self.service.status(self.workspace)['head'], head)

    def test_unknown_unpublished_local_commits_are_not_silently_pushed(self):
        self.branch()
        with Repo(self.workspace) as repo:
            from dulwich.objects import Commit
            prior = repo[repo.head()]
            manual = Commit()
            manual.tree = prior.tree
            manual.parents = [prior.id]
            manual.author = manual.committer = prior.author
            manual.author_time = manual.commit_time = 3
            manual.author_timezone = manual.commit_timezone = 0
            manual.message = b'Unreviewed manual commit\n'
            repo.object_store.add_object(manual)
            repo.refs[b'refs/heads/feature/work'] = manual.id
        self.edit()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.pushes, 0)

    def test_secret_author_in_prior_history_is_refused(self):
        self.branch()
        with Repo(self.workspace) as repo:
            from dulwich.objects import Commit
            prior = repo[repo.head()]
            malicious = Commit()
            malicious.tree = prior.tree
            malicious.parents = [prior.id]
            malicious.author = malicious.committer = fixtures.SYNTHETIC.encode()
            malicious.author_time = malicious.commit_time = 3
            malicious.author_timezone = malicious.commit_timezone = 0
            malicious.message = b'Fixture\n'
            repo.object_store.add_object(malicious)
            repo.refs[b'refs/heads/feature/work'] = malicious.id
        self.edit()
        with self.assertRaises(ValueError):
            self.publish()

    def test_casefold_duplicate_paths_never_create_a_publishable_tree(self):
        self.branch()
        self.edit()
        head = self.service.status(self.workspace)['head']
        with self.assertRaises(ValueError):
            self.publish(paths=['hello.txt', 'HELLO.txt'])
        self.assertEqual(self.service.status(self.workspace)['head'], head)
        self.assertEqual(self.pushes, 0)

    def test_final_push_rechecks_default_and_protection_after_local_commit(self):
        self.branch()
        self.edit()
        original = self.client
        def protected_before_send(*args):
            client = original(*args)
            send = client.send_pack
            def changed(*args, **kwargs):
                self.protected = True
                return send(*args, **kwargs)
            client.send_pack = changed
            return client
        self.service.git_factory = protected_before_send
        result = self.publish()
        self.assertFalse(result['ok'])
        self.assertTrue(result['local_commit_retained'])
        with Repo(self.remote) as repo:
            self.assertNotIn(b'refs/heads/feature/work', repo.refs)

    def test_author_is_visible_in_repository_approval_dialog(self):
        ui = Path(__file__).resolve().parents[1] / 'ui'
        self.assertIn('id="review-author"', (ui / 'index.html').read_text('utf-8'))
        self.assertIn("$('review-author').textContent", (ui / 'app.js').read_text('utf-8'))

    def test_index_failure_reports_retained_commit_without_pushing(self):
        self.branch()
        self.edit()
        from dulwich.index import Index
        prior = self.service.status(self.workspace)['head']
        with patch.object(Index, 'write', side_effect=OSError(fixtures.SYNTHETIC)):
            result = self.publish()
        self.assertFalse(result['ok'])
        self.assertTrue(result['local_commit_retained'])
        self.assertNotEqual(result['head'], prior)
        self.assertEqual(self.pushes, 0)
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(result))

    def test_non_github_result_opaque_session_contract_is_preserved(self):
        from glitch.redaction import RESULT
        self.vault.save('Session collision', 'bearer', 'https://example.invalid', {'token': self.session})
        value = self.store.redact({'ok': True, 'session': self.session, 'output': self.session}, RESULT)
        self.assertEqual(value['session'], self.session)
        self.assertNotEqual(value['output'], self.session)

    def test_publication_approval_payload_cannot_mutate_frozen_review(self):
        self.branch()
        self.edit()
        self.edit('unreviewed.txt', b'not part of approval')
        def attempted(action, preview):
            preview['paths'].append('unreviewed.txt')
            preview['branch'] = 'main'
            preview['author'] = 'Wrong <wrong@example.invalid>'
            return True
        self.approve.side_effect = attempted
        self.assertTrue(self.publish()['ok'])
        with Repo(self.remote) as repo:
            commit = repo[repo.refs[b'refs/heads/feature/work']]
            self.assertEqual(commit.author, b'Fixture <fixture@example.invalid>')
            self.assertEqual([e.path for e in iter_tree_contents(repo.object_store, commit.tree)], [b'hello.txt'])

    def test_status_exposes_bound_repository_without_secret_or_rebinding(self):
        result = self.tools.execute('github_repo_status', {})
        self.assertEqual(result['repository']['full_name'], 'fixture/sample')
        self.assertEqual(result['repository']['default_branch'], 'main')
        self.assertEqual(result['credential_id'], self.item['id'])
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(result))

    def test_pr_review_keeps_head_commit_sha_separate_from_head_branch(self):
        self.branch()
        self.edit()
        head = self.publish()['head']
        self.tools.execute('github_create_pull_request', {'head': 'feature/work', 'base': 'main',
                                                        'title': 'Fixture PR', 'body': ''})
        self.assertEqual(self.previews[-1]['head'], 'feature/work')
        self.assertEqual(self.previews[-1]['current_head'], head)

    def test_human_review_rejects_agent_input_and_commands_without_holding_leases(self):
        resources = self.service.resources
        self.assertTrue(hasattr(resources, 'human_review'), 'A sibling agent must not click its own GitHub approval')
        with resources.human_review(self.cancel):
            for action in ('Desktop Input', 'Run command'):
                with self.subTest(action=action), self.assertRaises(ValueError):
                    resources.acquire(action, self.workspace, self.cancel)
            key = next(iter(resources.workspaces))
            self.assertTrue(resources.workspaces[key].acquire(blocking=False))
            resources.workspaces[key].release()
        resources.acquire('Run command', self.workspace, self.cancel)
        resources.release()

    def test_git_human_review_waits_for_existing_automation_then_releases_policy(self):
        resources = self.service.resources
        self.assertTrue(hasattr(resources, 'human_review'))
        resources.acquire('Run command', self.workspace, self.cancel)
        entered = threading.Event()
        def review():
            with resources.human_review(self.cancel):
                entered.set()
        worker = threading.Thread(target=review)
        worker.start()
        self.assertFalse(entered.wait(.1))
        resources.release()
        worker.join(2)
        self.assertTrue(entered.is_set())
        self.assertFalse(worker.is_alive())


if __name__ == '__main__':
    unittest.main()
