"""Temporary repositories and synthetic tokens only; no live GitHub requests."""
import json
import difflib
import os
import ssl
import shutil
import subprocess
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from dulwich.client import LocalGitClient
from dulwich.config import ConfigFile, StackedConfig
from dulwich.objects import Blob, Commit, Tree
from dulwich.repo import Repo
from glitch.api import DesktopAPI
from glitch.engine import AgentEngine
from glitch.tests import test_vault as fixtures

try:
    from glitch.github_service import GitHubService, NativeGitClient, NativeHTTP, safe_remote
except ImportError:
    GitHubService = NativeGitClient = NativeHTTP = safe_remote = None


class GitHubTests(unittest.TestCase):
    def setUp(self):
        fixtures.VaultTests.setUp(self)
        self.assertIsNotNone(GitHubService, 'Task 5 requires the native GitHub backend')
        self.item = self.vault.save('GitHub fixture', 'github', 'https://github.com',
                                    {'token': fixtures.SYNTHETIC})
        self.cancel = threading.Event()
        self.http = Mock()
        self.http.side_effect = [(200, {}, {'login': 'fixture', 'id': 42}),
                                 (200, {}, self.repository())]
        self.source = self.root / 'source'
        self.source.mkdir()
        with Repo.init(self.source, config=StackedConfig([]), symlinks=False) as repo:
            self.commit(repo, {'hello.txt': b'hello\n', '.gitignore': b'ignored.txt\n'})
        self.factory = Mock(return_value=LocalGitClient())
        self.service = GitHubService(self.vault, http=self.http, git_factory=self.factory)

    @staticmethod
    def repository():
        return {'name': 'sample', 'owner': {'login': 'fixture'}, 'full_name': 'fixture/sample',
                'private': True, 'default_branch': 'main', 'permissions': {'pull': True, 'push': True}}

    @staticmethod
    def commit(repo, files, modes=None):
        tree = Tree()
        for name, data in files.items():
            blob = Blob.from_string(data)
            repo.object_store.add_object(blob)
            tree.add(name.encode(), (modes or {}).get(name, 0o100644), blob.id)
        repo.object_store.add_object(tree)
        commit = Commit()
        commit.tree = tree.id
        commit.author = commit.committer = b'Fixture <fixture@example.invalid>'
        commit.author_time = commit.commit_time = 1
        commit.author_timezone = commit.commit_timezone = 0
        commit.message = b'Fixture\n'
        commit.parents = []
        repo.object_store.add_object(commit)
        repo.refs.set_symbolic_ref(b'HEAD', b'refs/heads/main')
        repo.refs[b'refs/heads/main'] = commit.id

    def clone(self, folder='checkout'):
        # Inject a local fetch without opening the public network transport.
        client = LocalGitClient()
        def fetch(_path, target, **kwargs):
            return client.fetch(str(self.source), target, **kwargs)
        self.factory.return_value = Mock(fetch=fetch)
        return self.service.clone(self.item['id'], 'fixture', 'sample', self.root, folder, self.cancel)

    def test_identity_repository_read_never_claims_write_proven(self):
        result = self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)
        self.assertTrue(result['ok'])
        self.assertEqual(result['account']['login'], 'fixture')
        self.assertTrue(result['permissions']['read_verified'])
        self.assertIsNone(result['permissions']['contents_write'])
        self.assertIsNone(result['permissions']['pull_requests_write'])
        self.assertNotIn(fixtures.SYNTHETIC, json.dumps(result))
        self.assertEqual([c.args[0] for c in self.http.call_args_list], ['/user', '/repos/fixture/sample'])

    def test_denied_expired_missing_redirect_rate_limit_and_ca_error(self):
        for status, expected in [(401, 'expired'), (403, 'denied'), (404, 'unavailable'),
                                 (302, 'redirect'), (429, 'rate limit')]:
            with self.subTest(status=status):
                self.http.side_effect = None
                self.http.return_value = (status, {'Retry-After': '9'} if status == 429 else {},
                                          {'message': fixtures.SYNTHETIC})
                result = self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)
                self.assertFalse(result['ok'])
                self.assertIn(expected, result['error'].lower())
                self.assertNotIn(fixtures.SYNTHETIC, str(result))
        self.http.side_effect = ssl.SSLError(fixtures.SYNTHETIC)
        self.assertIn('TLS', self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)['error'])

    def test_wrong_credential_kind_and_invalid_names_never_resolve(self):
        wrong = self.vault.save('Wrong fixture', 'bearer', 'https://github.com', {'token': fixtures.SYNTHETIC})
        with patch.object(self.vault, 'resolve') as resolve:
            with self.assertRaises(ValueError):
                self.service.validate(wrong['id'], 'fixture', 'sample', self.cancel)
            for owner, repo in [('..', 'sample'), ('fixture', '../sample'), ('-option', 'sample'),
                                ('fixture', 'x?token=a'), ('fixture', 'repo.git'), ('fixture', '.git')]:
                with self.subTest(owner=owner, repo=repo), self.assertRaises(ValueError):
                    self.service.validate(self.item['id'], owner, repo, self.cancel)
        resolve.assert_not_called()

    def test_remotes_are_canonical_github_https_only(self):
        self.assertEqual(safe_remote('https://github.com/fixture/sample.git'), ('fixture', 'sample'))
        self.assertEqual(safe_remote('https://github.com/fixture/.github.git'), ('fixture', '.github'))
        for url in ['http://github.com/fixture/sample.git', 'https://evil.test/fixture/sample.git',
                    'https://token@github.com/fixture/sample.git', 'https://github.com:443/fixture/sample.git',
                    'https://github.com/fixture/sample.git?token=x', 'git@github.com:fixture/sample',
                    'https://github.com/fixture/../sample.git', 'file:///tmp/repo',
                    'https://github.com/fixture/%73ample.git', 'https://github.com/fixture/sample.git#x']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                safe_remote(url)

    def test_pagination_uses_bounded_host_constructed_pages_not_link_destinations(self):
        self.http.side_effect = [(200, {'Link': '<https://evil.test/steal>; rel="next"'},
                                  [self.repository()] * 100), (200, {}, [])]
        result = self.service.repositories(self.item['id'], self.cancel)
        self.assertEqual(len(result), 1)
        self.assertEqual([c.args[0] for c in self.http.call_args_list],
                         ['/user/repos?per_page=100&page=1', '/user/repos?per_page=100&page=2'])
        self.http.side_effect = None
        self.http.return_value = (200, {}, [self.repository()] * 100)
        with self.assertRaisesRegex(ValueError, 'limit'):
            self.service.repositories(self.item['id'], self.cancel)

    def test_malformed_oversized_and_mismatched_repo_data_are_refused(self):
        for data in ['bad', {'login': 'x'}, {'login': fixtures.SYNTHETIC, 'id': 42}]:
            self.http.side_effect = [(200, {}, data), (200, {}, self.repository() | {'full_name': 'other/sample'})]
            self.assertFalse(self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)['ok'])
        self.http.side_effect = [(200, {}, 'x' * (1024 * 1024 + 1))]
        self.assertFalse(self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)['ok'])

    def test_clone_native_status_staged_and_worktree_diff_no_git_process(self):
        with patch('subprocess.Popen', side_effect=AssertionError('No external processes')), \
                patch.object(StackedConfig, 'default_backends', side_effect=AssertionError('No global config')):
            result = self.clone()
            checkout = Path(result['workspace'])
            self.assertEqual((checkout / 'hello.txt').read_bytes(), b'hello\n')
            self.assertEqual(self.service.status(checkout)['unstaged'], [])
            (checkout / 'hello.txt').write_bytes(b'hello changed\n')
            (checkout / 'new.txt').write_bytes(b'new\n')
            (checkout / 'ignored.txt').write_bytes(b'ignored\n')
            status = self.service.status(checkout)
            self.assertEqual(status['unstaged'], ['hello.txt'])
            self.assertEqual(status['untracked'], ['new.txt'])
            diff = self.service.diff(checkout, ['hello.txt', 'new.txt'])
            self.assertIn('+hello changed', diff['diff'])
            self.assertIn('+new', diff['diff'])
            with Repo(checkout) as repo:
                blob = Blob.from_string(b'staged\n')
                repo.object_store.add_object(blob)
                index = repo.open_index(config=ConfigFile())
                index[b'hello.txt'].sha = blob.id
                index.write()
            self.assertEqual(self.service.status(checkout)['staged']['modify'], ['hello.txt'])
            self.assertIn('+staged', self.service.diff(checkout, ['hello.txt'])['diff'])
        self.assertNotIn(fixtures.SYNTHETIC.encode(), (checkout / '.git/config').read_bytes())
        self.assertEqual(result['repository']['full_name'], 'fixture/sample')

    def test_empty_repository_can_clone_without_head(self):
        empty = self.root / 'empty'
        empty.mkdir()
        Repo.init(empty, config=StackedConfig([]), symlinks=False).close()
        self.source = empty
        result = self.clone()
        self.assertIsNone(self.service.status(Path(result['workspace']))['head'])

    def test_clone_refuses_existing_even_empty_destination_and_invalid_folders(self):
        (self.root / 'existing').mkdir()
        for folder in ['existing', '../escape', 'nested/path', 'NUL', 'x.', '-option', '.git', 'x:y', '']:
            with self.subTest(folder=folder), self.assertRaises(ValueError):
                self.clone(folder)
        self.assertTrue((self.root / 'existing').is_dir())
        self.factory.assert_not_called()

    def test_cancel_before_or_during_clone_owned_cleanup_only(self):
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            self.clone()
        self.assertFalse((self.root / 'checkout').exists())
        self.cancel.clear()
        sibling = self.root / 'keep.txt'
        sibling.write_bytes(b'keep')
        self.factory.return_value = Mock()
        self.factory.return_value.fetch.side_effect = lambda *a, **k: (self.cancel.set() or None)
        with self.assertRaises(InterruptedError):
            self.service.clone(self.item['id'], 'fixture', 'sample', self.root, 'checkout', self.cancel)
        self.assertFalse((self.root / 'checkout').exists())
        self.assertEqual(sibling.read_bytes(), b'keep')

    def test_partial_failure_never_leaks_transport_exception(self):
        self.factory.return_value = Mock()
        self.factory.return_value.fetch.side_effect = RuntimeError(fixtures.SYNTHETIC)
        with self.assertRaises(ValueError) as error:
            self.service.clone(self.item['id'], 'fixture', 'sample', self.root, 'checkout', self.cancel)
        self.assertNotIn(fixtures.SYNTHETIC, str(error.exception))
        self.assertFalse((self.root / 'checkout').exists())

    def test_failed_clone_retains_replacement_directory_not_owned_by_operation(self):
        def replaced(*args, **kwargs):
            (self.root / 'checkout').rename(self.root / 'original-partial')
            (self.root / 'checkout').mkdir()
            (self.root / 'checkout/keep.txt').write_bytes(b'user replacement')
            raise RuntimeError('Synthetic failure')
        self.factory.return_value = Mock(fetch=Mock(side_effect=replaced))
        with self.assertRaisesRegex(ValueError, 'retained'):
            self.service.clone(self.item['id'], 'fixture', 'sample', self.root, 'checkout', self.cancel)
        self.assertEqual((self.root / 'checkout/keep.txt').read_bytes(), b'user replacement')
        self.assertTrue((self.root / 'original-partial').is_dir())

    def test_repo_metadata_escape_alternates_and_gitfile_refused(self):
        checkout = Path(self.clone()['workspace'])
        alternate = checkout / '.git/objects/info/alternates'
        alternate.write_text(str(self.source / '.git/objects'), encoding='ascii')
        with self.assertRaises(ValueError):
            self.service.status(checkout)
        alternate.unlink()
        (checkout / '.git').rename(checkout / 'retained-git')
        (checkout / '.git').write_bytes(b'gitdir: ../source/.git\n')
        with self.assertRaises(ValueError):
            self.service.diff(checkout, ['hello.txt'])

    def test_status_path_results_remain_bounded_after_exact_redaction(self):
        checkout = Path(self.clone()['workspace'])
        for i in range(600):
            (checkout / f'new-{i:04}.txt').write_bytes(b'new')
        result = self.service.status(checkout)
        self.assertTrue(result['truncated'])
        self.assertEqual(len(result['untracked']), 500)
        (checkout / 'hello.txt').write_bytes(fixtures.SYNTHETIC.encode())
        self.assertNotIn(fixtures.SYNTHETIC, str(self.service.diff(checkout, ['hello.txt'])))

    def test_diff_reports_empty_file_add_delete_and_staged_mode_changes(self):
        checkout = Path(self.clone()['workspace'])
        (checkout / 'empty.txt').write_bytes(b'')
        self.assertIn('New empty file', self.service.diff(checkout, ['empty.txt'])['diff'])
        with Repo(checkout) as repo:
            blob = Blob.from_string(b'')
            repo.object_store.add_object(blob)
            index = repo.open_index(config=ConfigFile())
            from dulwich.index import index_entry_from_stat
            index[b'empty.txt'] = index_entry_from_stat((checkout / 'empty.txt').stat(), blob.id, 0o100644)
            index[b'hello.txt'].mode = 0o100755
            index.write()
        self.assertIn('Mode changed', self.service.diff(checkout, ['hello.txt'])['diff'])
        (checkout / 'empty.txt').unlink()
        self.assertIn('Deleted empty file', self.service.diff(checkout, ['empty.txt'])['diff'])

    def test_diff_redacts_complete_source_before_output_cap_crosses_secret(self):
        from glitch.github_service import MAX_DIFF_BYTES
        checkout = Path(self.clone()['workspace'])
        header = ''.join(difflib.unified_diff([], ['x\n'], 'a/cap.txt (working)', 'b/cap.txt (working)'))
        prefix_size = header.index('+x\n') + 1
        text = 'a' * (MAX_DIFF_BYTES - prefix_size - 14) + fixtures.SYNTHETIC + 'tail\n'
        (checkout / 'cap.txt').write_bytes(text.encode())
        preview = self.service.diff(checkout, ['cap.txt'])
        self.assertTrue(preview['truncated'])
        self.assertLessEqual(len(preview['diff'].encode()), MAX_DIFF_BYTES)
        self.assertTrue('synthetic-' not in preview['diff'], 'A saved credential prefix crossed the output cap.')
        safe_text = self.vault.redact(text)
        expected = ''.join(difflib.unified_diff([], safe_text.splitlines(True),
                           'a/cap.txt (working)', 'b/cap.txt (working)')).encode()[:MAX_DIFF_BYTES].decode()
        self.assertTrue(preview['diff'] == expected, 'The cap must apply only to protected display text.')

    def test_diff_redacts_multiline_source_before_segmentation_and_markers(self):
        secret = 'synthetic-fragment-FIRST\nsynthetic-fragment-SECOND'
        with patch('glitch.storage.protect', side_effect=fixtures.fixture_cipher):
            self.store.save_settings({'supervisor_key': secret})
            self.assertEqual(self.store.supervisor_key(), secret)
            self.assertEqual(self.vault.redact(secret), '[credential removed]')
            with Repo(self.source) as repo:
                self.commit(repo, {'multiline.txt': (secret + '\nold public\n').encode()})
            checkout = Path(self.clone()['workspace'])
            (checkout / 'multiline.txt').write_bytes((secret + '\nnew public\n').encode())
            # Redaction must already have happened when data reaches difflib.
            original_diff = difflib.unified_diff
            inputs = []
            def protected_diff(a, b, *args, **kwargs):
                inputs.append(''.join(a) + ''.join(b))
                return original_diff(a, b, *args, **kwargs)
            with patch('glitch.github_service.difflib.unified_diff', side_effect=protected_diff):
                preview = self.service.diff(checkout, ['multiline.txt'])
            self.assertTrue(inputs)
            self.assertNotIn('synthetic-fragment', ''.join(inputs))
            self.assertIn('[credential removed]', preview['diff'])
            self.assertNotIn('synthetic-fragment', preview['diff'])
            self.assertIn('-old public', preview['diff'])
            self.assertIn('+new public', preview['diff'])

    def test_diff_tracks_original_bytes_when_redacted_display_is_equal(self):
        self.vault.save('Other synthetic token', 'github', 'https://github.com',
                        {'token': 'synthetic-alternate-fixture-ONLY'})
        self.vault.save('Third synthetic token', 'github', 'https://github.com',
                        {'token': 'synthetic-third-fixture-ONLY'})
        with Repo(self.source) as repo:
            self.commit(repo, {'hello.txt': fixtures.SYNTHETIC.encode() + b'\n'})
        checkout = Path(self.clone()['workspace'])
        with Repo(checkout) as repo:
            blob = Blob.from_string(b'synthetic-alternate-fixture-ONLY\n')
            repo.object_store.add_object(blob)
            index = repo.open_index(config=ConfigFile())
            index[b'hello.txt'].sha = blob.id
            index.write()
        (checkout / 'hello.txt').write_bytes(b'synthetic-third-fixture-ONLY\n')
        preview = self.service.diff(checkout, ['hello.txt'])
        self.assertIn('Protected content differs (staged)', preview['diff'])
        self.assertIn('Protected content differs (working)', preview['diff'])
        self.assertNotIn('synthetic-', preview['diff'])

    def test_diff_reports_distinct_invalid_utf8_for_staged_and_working_bytes(self):
        with Repo(self.source) as repo:
            self.commit(repo, {'invalid.txt': b'\xff\n'})
        checkout = Path(self.clone()['workspace'])
        with Repo(checkout) as repo:
            blob = Blob.from_string(b'\xfe\n')
            repo.object_store.add_object(blob)
            index = repo.open_index(config=ConfigFile())
            index[b'invalid.txt'].sha = blob.id
            index.write()
        (checkout / 'invalid.txt').write_bytes(b'\xfd\n')
        status = self.service.status(checkout)
        self.assertIn('invalid.txt', status['staged']['modify'])
        self.assertIn('invalid.txt', status['unstaged'])
        preview = self.service.diff(checkout, ['invalid.txt'])
        self.assertIn('Binary/non-UTF-8 file differs (staged)', preview['diff'])
        self.assertIn('Binary/non-UTF-8 file differs (working)', preview['diff'])
        self.assertNotIn('\ufffd', preview['diff'])
        self.assertFalse(preview['truncated'])

    def test_diff_separates_unterminated_removed_and_added_lines(self):
        with Repo(self.source) as repo:
            self.commit(repo, {'plain.txt': b'old'})
        checkout = Path(self.clone()['workspace'])
        (checkout / 'plain.txt').write_bytes(b'new')
        preview = self.service.diff(checkout, ['plain.txt'])
        self.assertIn('-old\n\\ No newline at end of file\n', preview['diff'])
        self.assertIn('+new\n\\ No newline at end of file\n', preview['diff'])
        self.assertNotIn('-old+new', preview['diff'])
        self.assertEqual(preview['diff'].count('\\ No newline at end of file'), 2)

    def test_clone_checkout_casefold_directory_collisions(self):
        with Repo(self.source) as repo:
            self.commit(repo, {'Readme': b'a', 'README': b'b'})
        with self.assertRaises(ValueError):
            self.clone()
        with Repo(self.source) as repo:
            root = Tree()
            for directory, name in [('lower', 'x.txt'), ('LOWER', 'y.txt')]:
                blob = Blob.from_string(b'fixture')
                repo.object_store.add_object(blob)
                child = Tree()
                child.add(name.encode(), 0o100644, blob.id)
                repo.object_store.add_object(child)
                root.add(directory.encode(), 0o040000, child.id)
            repo.object_store.add_object(root)
            commit = repo.object_store[repo.head()]
            commit.tree = root.id
            repo.object_store.add_object(commit)
            repo.refs[b'refs/heads/main'] = commit.id
        with self.assertRaises(ValueError):
            self.clone()

    def test_option_shaped_default_branch_refused(self):
        with Repo(self.source) as repo:
            head = repo.head()
            repo.refs[b'refs/heads/-option'] = head
            repo.refs.set_symbolic_ref(b'HEAD', b'refs/heads/-option')
        with self.assertRaises(ValueError):
            self.clone()

    def test_structural_redaction_collisions_preserve_opaque_credential_id(self):
        self.vault.save('Protocol collision', 'bearer', 'https://other.test', {'token': 'credential_id'})
        self.vault.save('Opaque collision', 'basic', 'https://other.test',
                        {'username': self.item['id'], 'password': fixtures.SYNTHETIC})
        result = self.service.validate(self.item['id'], 'fixture', 'sample', self.cancel)
        self.assertEqual(result['credential_id'], self.item['id'])
        self.assertIn('permissions', result)

    def test_status_and_diff_errors_redact_bad_config_content(self):
        checkout = Path(self.clone()['workspace'])
        (checkout / '.git/config').write_bytes(('invalid ' + fixtures.SYNTHETIC).encode())
        for operation in [lambda: self.service.status(checkout), lambda: self.service.diff(checkout, ['hello.txt'])]:
            with self.assertRaises(ValueError) as error:
                operation()
            self.assertNotIn(fixtures.SYNTHETIC, str(error.exception))

    def test_status_lease_wait_is_bounded(self):
        from glitch.resources import SHARED_RESOURCES
        checkout = Path(self.clone()['workspace'])
        lock = SHARED_RESOURCES.workspaces[os.path.normcase(os.path.realpath(checkout))]
        lock.acquire()
        timer = threading.Timer(.7, lock.release)
        timer.start()
        try:
            started = time.monotonic()
            with patch('glitch.github_service.LOCAL_DEADLINE', .1):
                with self.assertRaises(TimeoutError):
                    self.service.status(checkout)
            self.assertLess(time.monotonic() - started, .4)
        finally:
            timer.join()

    def test_native_smart_git_fetch_over_real_fixture_tls(self):
        import http.client
        from socketserver import ThreadingMixIn
        from wsgiref.simple_server import WSGIServer, WSGIRequestHandler, make_server
        from dulwich.web import make_wsgi_chain
        from dulwich.server import DictBackend
        from glitch.github_service import SafeRepo
        openssl = shutil.which('openssl') or 'C:/Program Files/Git/usr/bin/openssl.exe'
        if not Path(openssl).is_file():
            self.skipTest('Temporary TLS fixture requires OpenSSL, never product Git')
        cert, key = self.root / 'cert.pem', self.root / 'key.pem'
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=Glitch fixture', '-addext', 'subjectAltName=IP:127.0.0.1',
                        '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True, timeout=10)
        with SafeRepo(self.source) as source:
            class Server(ThreadingMixIn, WSGIServer):
                daemon_threads = True
            class Handler(WSGIRequestHandler):
                def log_message(self, *_):
                    pass
            app = make_wsgi_chain(DictBackend({'/fixture/sample.git': source}))
            received = []
            def record(environ, start_response):
                received.append((environ['PATH_INFO'], environ.get('HTTP_AUTHORIZATION')))
                return app(environ, start_response)
            server = make_server('127.0.0.1', 0, record, server_class=Server, handler_class=Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            original = http.client.HTTPSConnection
            def local_connection(host, **kwargs):
                self.assertEqual(host, 'github.com')
                return original('127.0.0.1', server.server_port, **kwargs)
            self.vault.save('GitHub fixture', 'github', 'https://github.com',
                            {'token': fixtures.SYNTHETIC, 'ca_pem': cert.read_text('ascii')}, self.item['id'])
            try:
                with patch('glitch.github_service.HTTPSConnection', side_effect=local_connection), \
                        patch('subprocess.Popen', side_effect=AssertionError('No external product process')), \
                        patch.object(StackedConfig, 'default_backends', side_effect=AssertionError('No global config')):
                    result = GitHubService(self.vault).clone(self.item['id'], 'fixture', 'sample', self.root, 'native', self.cancel)
                self.assertEqual((Path(result['workspace']) / 'hello.txt').read_bytes(), b'hello\n')
                self.assertEqual([r[0] for r in received], ['/fixture/sample.git/info/refs', '/fixture/sample.git/git-upload-pack'])
                self.assertTrue(all(r[1].startswith('Basic ') for r in received))
                self.assertNotIn(fixtures.SYNTHETIC, str(result))
            finally:
                server.shutdown()
                server.server_close()
                worker.join(3)

    def test_hostile_repo_config_includes_helpers_filters_and_external_worktree(self):
        checkout = Path(self.clone()['workspace'])
        for extra in [b'[include]\n path = C:/outside/config\n', b'[filter "evil"]\n process = evil\n',
                      b'[core]\n worktree = C:/outside\n', b'[credential]\n helper = evil\n',
                      b'[http]\n sslVerify = false\n', b'[core]\n hooksPath = C:/outside\n',
                      b'[url "https://evil.test"]\n insteadOf = https://github.com\n',
                      b'[fetch]\n bundleURI = https://evil.test/bundle\n']:
            with self.subTest(extra=extra):
                config = checkout / '.git/config'
                original = config.read_bytes()
                config.write_bytes(original + extra)
                try:
                    with patch('subprocess.Popen', side_effect=AssertionError('External config executed')):
                        with self.assertRaises(ValueError):
                            self.service.status(checkout)
                finally:
                    config.write_bytes(original)

    def test_tree_symlinks_submodules_windows_paths_refused_before_checkout(self):
        for name, mode in [('escape', 0o120000), ('submodule', 0o160000),
                           ('.git', 0o100644), ('NUL', 0o100644), ('hello:ads', 0o100644)]:
            with self.subTest(name=name):
                with Repo(self.source) as repo:
                    self.commit(repo, {name: b'outside'}, {name: mode})
                with self.assertRaises(ValueError):
                    self.clone()
                self.assertFalse((self.root / 'checkout').exists())

    def test_diff_refuses_traversal_metadata_and_bounds_large_files_and_output(self):
        checkout = Path(self.clone()['workspace'])
        for paths in [['../keep'], ['.git/config'], ['C:/outside'], ['hello.txt:ads'], [], ['x'] * 101]:
            with self.subTest(paths=paths[:2]), self.assertRaises(ValueError):
                self.service.diff(checkout, paths)
        (checkout / 'new.txt').write_bytes(b'x' * (2 * 1024 * 1024 + 1))
        result = self.service.diff(checkout, ['new.txt'])
        self.assertTrue(result['truncated'])
        self.assertLessEqual(len(result['diff']), 65536)

    def test_diff_refuses_quadratic_line_work_before_calling_diff_engine(self):
        checkout = Path(self.clone()['workspace'])
        (checkout / 'new.txt').write_bytes(b'line\n' * 10000)
        with patch('glitch.github_service.difflib.unified_diff', side_effect=AssertionError('Unbounded diff work')):
            result = self.service.diff(checkout, ['new.txt'])
        self.assertTrue(result['truncated'])
        self.assertIn('limit', result['diff'])
        (checkout / 'new.txt').write_bytes(b'new\n' * 40000)
        result = self.service.diff(checkout, ['new.txt'])
        self.assertTrue(result['truncated'])
        self.assertLessEqual(len(result['diff']), 65536)

    @unittest.skipUnless(os.name == 'nt', 'Windows junction safety')
    def test_junction_parent_and_workspace_escape(self):
        import subprocess
        outside = self.root / 'outside'
        outside.mkdir()
        junction = self.root / 'junction'
        subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(outside)],
                       check=True, capture_output=True)
        self.addCleanup(lambda: os.rmdir(junction))
        with self.assertRaises(ValueError):
            self.service.clone(self.item['id'], 'fixture', 'sample', junction, 'checkout', self.cancel)
        checkout = Path(self.clone()['workspace'])
        linked = checkout / 'linked'
        subprocess.run(['cmd', '/c', 'mklink', '/J', str(linked), str(outside)],
                       check=True, capture_output=True)
        self.addCleanup(lambda: os.rmdir(linked))
        with self.assertRaises(ValueError):
            self.service.diff(checkout, ['linked/file.txt'])


class NativeTransportTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(NativeHTTP, 'Task 5 requires fixed-origin native HTTPS')
        self.cancel = threading.Event()
        self.response = Mock(status=200)
        self.response.getheader.return_value = 'application/x-git-upload-pack-advertisement'
        self.response.getheaders.return_value = []
        self.response.read.side_effect = [b'{}', b'']
        self.connection = Mock()
        self.connection.getresponse.return_value = self.response
        self.transport = patch('glitch.github_service.HTTPSConnection', return_value=self.connection)
        self.transport.start()
        self.addCleanup(self.transport.stop)

    def test_api_verified_tls_fixed_host_and_bearer_only_in_header(self):
        result = NativeHTTP()('/user', {'token': fixtures.SYNTHETIC}, self.cancel, float('inf'))
        self.assertEqual(result[0], 200)
        self.assertEqual(self.transport.get_original()[0].call_args.args[0], 'api.github.com')
        args, kwargs = self.connection.request.call_args
        self.assertEqual(args[:2], ('GET', '/user'))
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer ' + fixtures.SYNTHETIC)
        self.connection.close.assert_called()

    def test_git_canonical_route_no_redirect_and_no_arbitrary_request_headers(self):
        client = NativeGitClient('https://github.com/fixture/sample.git', {'token': fixtures.SYNTHETIC},
                                 self.cancel, float('inf'))
        for url in ['https://evil.test/data', 'https://github.com/other/sample.git/info/refs',
                    'https://github.com/fixture/sample.git/objects/pack',
                    'https://github.com/fixture/sample.git/info/refs?service=git-receive-pack']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                client._http_request(url)
        self.connection.request.assert_not_called()
        self.response.status = 302
        with self.assertRaises(ValueError):
            client._http_request('https://github.com/fixture/sample.git/info/refs?service=git-upload-pack')
        self.assertEqual(self.connection.request.call_count, 1)
        self.connection.close.assert_called()

    def test_native_cancellation_and_deadline_before_auth(self):
        self.cancel.set()
        with self.assertRaises(InterruptedError):
            NativeHTTP()('/user', {'token': fixtures.SYNTHETIC}, self.cancel, float('inf'))
        self.cancel.clear()
        with self.assertRaises(TimeoutError):
            NativeHTTP()('/user', {'token': fixtures.SYNTHETIC}, self.cancel, 0)
        self.connection.request.assert_not_called()

    def test_cancel_and_deadline_interrupt_blocked_headers(self):
        for cancel_after in (True, False):
            self.cancel.clear()
            closed = threading.Event()
            self.connection.close.side_effect = closed.set
            def headers():
                closed.wait(3)
                raise OSError('Synthetic blocked headers')
            self.connection.getresponse.side_effect = headers
            timer = threading.Timer(.1, self.cancel.set)
            deadline = float('inf') if cancel_after else time.monotonic() + .1
            if cancel_after:
                timer.start()
            started = time.monotonic()
            try:
                with self.assertRaises(InterruptedError if cancel_after else TimeoutError):
                    NativeHTTP()('/user', {'token': fixtures.SYNTHETIC}, self.cancel, deadline)
                self.assertLess(time.monotonic() - started, .5)
            finally:
                timer.cancel()

    def test_api_body_limit_and_git_auth_header_not_caller_overridable(self):
        self.response.read.side_effect = [b'x' * (1024 * 1024 + 1)]
        with self.assertRaises(ValueError):
            NativeHTTP()('/user', {'token': fixtures.SYNTHETIC}, self.cancel, float('inf'))
        self.connection.close.assert_called()
        client = NativeGitClient('https://github.com/fixture/sample.git', {'token': fixtures.SYNTHETIC},
                                 self.cancel, float('inf'))
        with self.assertRaises(ValueError):
            client._http_request('https://github.com/fixture/sample.git/info/refs?service=git-upload-pack',
                                 {'Authorization': 'evil'})


class BridgeTests(unittest.TestCase):
    repository = staticmethod(GitHubTests.repository)
    commit = staticmethod(GitHubTests.commit)

    def setUp(self):
        GitHubTests.setUp(self)
        self.engine = AgentEngine(self.store, Mock())
        self.api = DesktopAPI(self.store, self.engine, Mock())
        self.api._github = self.service

    def test_bridge_clone_only_native_selected_parent_and_explicit_confirmation(self):
        self.assertTrue(hasattr(self.api, 'github_clone'), 'Task 5 requires native settings bridge')
        with self.assertRaises(ValueError):
            self.api.github_clone(self.item['id'], 'fixture', 'sample', 'checkout', False)
        self.api._github_parent = self.root
        with patch.object(self.service, 'clone', return_value={'ok': True, 'workspace': str(self.source),
                'credential_id': self.item['id'], 'repository': self.repository()}) as clone:
            self.api.github_clone(self.item['id'], 'fixture', 'sample', 'checkout', True)
        self.assertEqual(clone.call_args.args[3], self.root)
        self.assertEqual(len(self.store.sessions()), 1)

    def test_bridge_active_run_and_recovery_block_network_and_author_mutations(self):
        self.assertTrue(hasattr(self.api, 'github_validate'), 'Task 5 requires native settings bridge')
        self.engine.running_session = 'fixture-running'
        for operation in [lambda: self.api.github_validate(self.item['id'], 'fixture', 'sample'),
                          lambda: self.api.github_repositories(self.item['id']),
                          lambda: self.api.github_save_author('Fixture', 'fixture@example.invalid')]:
            with self.assertRaises(ValueError):
                operation()
        self.http.assert_not_called()
        self.engine.running_session = None
        self.api._recovery_required = True
        with self.assertRaises(ValueError):
            self.api.github_validate(self.item['id'], 'fixture', 'sample')

    def test_author_persisted_and_invalid_identity_refused(self):
        self.assertTrue(hasattr(self.api, 'github_save_author'), 'Task 5 requires author identity')
        self.api.github_save_author('Fixture Author', 'fixture@example.invalid')
        self.assertEqual(self.store.settings()['github_author_name'], 'Fixture Author')
        self.assertEqual(self.store.settings()['github_author_email'], 'fixture@example.invalid')
        for name, email in [('Bad\nName', 'a@b.test'), ('<Bad>', 'a@b.test'), ('ok', 'not-email')]:
            with self.assertRaises(ValueError):
                self.api.github_save_author(name, email)

    def test_cancelled_validation_returns_safe_result_without_bridge_traceback(self):
        with patch.object(self.service, 'validate', side_effect=InterruptedError(fixtures.SYNTHETIC)):
            result = self.api.github_validate(self.item['id'], 'fixture', 'sample')
        self.assertFalse(result['ok'])
        self.assertIn('cancelled', result['error'])
        self.assertNotIn(fixtures.SYNTHETIC, str(result))

    def test_cancel_arriving_before_dispatch_is_not_erased_at_admission(self):
        self.api.github_cancel()
        result = self.api.github_validate(self.item['id'], 'fixture', 'sample')
        self.assertFalse(result['ok'])
        self.assertIn('cancelled', result['error'])
        self.http.assert_not_called()
        self.api.github_reset_cancel()
        self.assertTrue(self.api.github_validate(self.item['id'], 'fixture', 'sample')['ok'])

    def test_operation_holds_run_admission_and_cancel_does_not_wait_for_it(self):
        entered, cancelled = threading.Event(), threading.Event()
        results = []
        def validate(*args):
            entered.set()
            self.assertTrue(self.api._github_cancel.wait(3))
            cancelled.set()
            return {'ok': False, 'error': 'Cancelled fixture'}
        with patch.object(self.service, 'validate', side_effect=validate):
            worker = threading.Thread(target=lambda: results.append(self.api.github_validate(self.item['id'], 'fixture', 'sample')))
            worker.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertFalse(self.engine.lock.acquire(blocking=False))
                started = time.monotonic()
                self.api.github_cancel()
                self.assertLess(time.monotonic() - started, .3)
                self.assertTrue(cancelled.wait(2))
            finally:
                self.api.github_cancel()
                worker.join(3)
        self.assertEqual(len(results), 1)
        self.assertFalse(self.api._github_busy)


class SettingsUiTests(unittest.TestCase):
    def test_masked_github_settings_and_native_actions_exist(self):
        root = Path(__file__).parents[1]
        html = (root / 'ui/index.html').read_text(encoding='utf-8')
        script = (root / 'ui/app.js').read_text(encoding='utf-8')
        self.assertIn('id="settings-github"', html)
        self.assertRegex(html, r'id="github-token"[^>]*type="password"')
        for action in ['github_validate', 'github_repositories', 'github_choose_directory',
                       'github_clone', 'github_cancel', 'github_save_author']:
            self.assertIn("call('" + action + "'", script)
        self.assertIn('github-author-name', html)
        self.assertIn('github-author-email', html)
        self.assertIn('contents_write', script)
        self.assertIn("$('github-token').value='';", script)

    def test_pinned_native_dependency_and_full_upstream_licensing_are_packaged(self):
        import importlib.metadata
        root = Path(__file__).parents[1]
        self.assertEqual(importlib.metadata.version('dulwich'), '1.2.17')
        for name in ('requirements.txt', 'requirements-lock.txt'):
            self.assertIn('dulwich==1.2.17', (root / name).read_text())
        self.assertIn("collect_all('dulwich')", (root / 'Glitch.spec').read_text())
        copying = (root / 'licenses/dulwich-COPYING.txt').read_text()
        distribution = importlib.metadata.distribution('dulwich')
        original = distribution.locate_file('dulwich-1.2.17.dist-info/licenses/COPYING').read_text()
        self.assertEqual(copying.rstrip(), original.rstrip())
        self.assertIn('Apache License 2.0 option', (root / 'licenses/dulwich-NOTICE.txt').read_text())


if __name__ == '__main__':
    unittest.main()
