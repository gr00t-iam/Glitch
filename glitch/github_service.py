"""Fixed-host GitHub connections and bounded Python-native repository operations."""
import base64
import difflib
import hashlib
from dataclasses import dataclass
from http.client import HTTPSConnection
from contextlib import contextmanager
from functools import wraps
import io
import json
import os
import re
import shutil
import socket
import ssl
import stat
import threading
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, urlencode

from dulwich.client import AbstractHttpGitClient
from dulwich.config import ConfigFile, StackedConfig
from dulwich.ignore import IgnoreFilter, IgnoreFilterManager
from dulwich.index import Index, index_entry_from_stat
from dulwich.object_store import iter_tree_contents
from dulwich.objects import Blob, Commit
from dulwich.refs import check_ref_format
from dulwich.repo import Repo
from glitch.redaction import GITHUB_RESULT, GITHUB_REPOSITORY
from glitch.resources import SHARED_RESOURCES, ResourceRefusal

API_BYTES = 1024 * 1024
MAX_PAGES = 10
MAX_FILES = 10000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_CHECKOUT_BYTES = 256 * 1024 * 1024
MAX_PACK_BYTES = 512 * 1024 * 1024
MAX_DIFF_BYTES = 65536
MAX_COMMITS = 1000
TIMEOUT = 2
API_DEADLINE = 15
CLONE_DEADLINE = 120
LOCAL_DEADLINE = 15
RESERVED = {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'} | {
    f'{prefix}{n}' for prefix in ('COM', 'LPT') for n in range(1, 10)}


def check(cancel, deadline):
    if cancel.is_set():
        raise InterruptedError('GitHub operation cancelled.')
    if time.monotonic() >= deadline:
        raise TimeoutError('GitHub operation exceeded its time limit.')


def names(owner, repo):
    if (not isinstance(owner, str) or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?', owner)
            or not isinstance(repo, str) or not re.fullmatch(r'[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}', repo)
            or repo.endswith('.git') or repo.endswith('.') or repo.lower() == '.git'):
        raise ValueError('Choose a valid GitHub owner and repository name, not a URL or option.')
    return owner, repo


def safe_remote(url):
    if not isinstance(url, str):
        raise ValueError('Only canonical https://github.com/owner/repository.git remotes are supported.')
    match = re.fullmatch(r'https://github\.com/([^/]+)/([^/]+)\.git', url)
    if not match:
        raise ValueError('Only canonical https://github.com/owner/repository.git remotes are supported.')
    return names(*match.groups())


def safe_branch(ref):
    if (not isinstance(ref, bytes) or len(ref) > 211 or not ref.startswith(b'refs/heads/') or
            not check_ref_format(ref) or any(part.startswith(b'-') for part in ref.split(b'/')[2:])):
        raise ValueError('Unsafe or option-shaped Git branch refused.')
    return ref


def file_path(value):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise ValueError('Use a bounded relative file path.')
    parts = value.split('/')
    for part in parts:
        if (not part or part in ('.', '..') or part.lower() in ('.git', 'git~1') or
                part.startswith('-') or part.endswith(('.', ' ')) or
                any(ord(c) < 32 or ord(c) == 127 or c in '\\:*?"<>|' for c in part) or
                part.split('.')[0].upper() in RESERVED):
            raise ValueError('Unsafe Windows path, metadata path, or workspace escape refused.')
    return parts


def no_links(path):
    """Check lexical ancestors, not just resolve(): junctions must not disappear."""
    path = Path(os.path.abspath(path))
    for entry in [*reversed(path.parents), path]:
        if not os.path.lexists(entry):
            continue
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('Symlink or junction paths are not supported.')
    return path


def bounded_read(path, limit):
    no_links(path)
    with Path(path).open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Repository data exceeds its size limit.')
    return data


def branch(value):
    if (not isinstance(value, str) or value in ('HEAD', '') or value.startswith('refs/') or
            len(value) > 200 or any(ord(c) < 33 or ord(c) > 126 for c in value)):
        raise ValueError('Choose a safe named feature branch.')
    return safe_branch(('refs/heads/' + value).encode('ascii'))


def protected_path(name):
    parts = file_path(name)
    for part in parts:
        part = part.lower()
        if (part in {'.ssh', '.aws', '.azure', '.glitch', '.gitmodules', '.gitattributes',
                     'credentials.json', 'glitch.sqlite3', 'glitch.sqlite3-wal', 'glitch.sqlite3-shm'} or
                part.startswith('.env') or part.endswith(('.pem', '.key', '.dpapi'))):
            raise ValueError('Protected credential or Git configuration path refused.')


@dataclass(frozen=True)
class PublicationReview:
    """Only immutable host-generated state crosses the unlocked approval interval."""
    name: str
    arguments: str
    connection: str
    fingerprint: str
    remote_refs: tuple
    preview: str


def digest(value):
    return hashlib.sha256(value).hexdigest()


class _Response:
    """Own the connection and actively interrupt slow headers/body on Stop/deadline."""
    def __init__(self, host, route, payload, cancel, deadline, headers, body=None, limit=API_BYTES):
        check(cancel, deadline)
        self.cancel, self.deadline, self.limit = cancel, deadline, limit
        self.received = 0
        self.connection = HTTPSConnection(host, timeout=TIMEOUT,
            context=ssl.create_default_context(cadata=payload.get('ca_pem')))
        self.response = None
        self.finished = threading.Event()
        self.transport_socket = None

        def watch():
            while not self.finished.wait(.05):
                if cancel.is_set() or time.monotonic() >= deadline:
                    if self.transport_socket:
                        try:
                            self.transport_socket.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
                    self.connection.close()
                    return
        self.watcher = threading.Thread(target=watch, daemon=True)
        self.watcher.start()
        try:
            self.connection.connect()
            self.transport_socket = self.connection.sock
            check(cancel, deadline)
            self.connection.request('GET' if body is None else 'POST', route, body=body, headers=headers)
            self.response = self.connection.getresponse()
            check(cancel, deadline)
            self.status = self.response.status
            self.headers = dict(self.response.getheaders())
            self.content_type = self.response.getheader('Content-Type')
            self.redirect_location = ''
        except BaseException:
            self.close()
            check(cancel, deadline)
            raise

    def read(self, size):
        check(self.cancel, self.deadline)
        try:
            data = self.response.read(min(size, 65536, self.limit - self.received + 1))
        except Exception:
            check(self.cancel, self.deadline)
            raise
        check(self.cancel, self.deadline)
        self.received += len(data)
        if self.received > self.limit:
            raise ValueError('GitHub response exceeded its size limit.')
        return data

    def close(self):
        self.finished.set()
        if self.response is not None:
            self.response.close()
        self.connection.close()
        self.watcher.join(timeout=.2)


class NativeHTTP:
    def __call__(self, endpoint, payload, cancel, deadline, body=None):
        # Routes are host-constructed. Never follow pagination Link URLs.
        prefix = r'/repos/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+'
        read = (r'/user|/user/repos\?per_page=100&page=[1-9][0-9]*|' + prefix +
                r'|'+prefix+r'/branches/[A-Za-z0-9_.%~-]+|'+prefix+
                r'/pulls\?state=all&head=[A-Za-z0-9_.%~-]+&base=[A-Za-z0-9_.%~-]+&per_page=100')
        if not re.fullmatch(prefix + r'/pulls' if body is not None else read, endpoint):
            raise ValueError('Unsupported GitHub API route.')
        headers = {'Authorization': 'Bearer ' + payload['token'], 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Glitch'}
        encoded = json.dumps(body, allow_nan=False).encode() if body is not None else None
        if encoded is not None:
            if len(encoded) > API_BYTES:
                raise ValueError('GitHub request size limit reached.')
            headers['Content-Type'] = 'application/json'
        response = _Response('api.github.com', endpoint, payload, cancel, deadline, headers, encoded)
        try:
            if response.status not in (200, 201):
                return response.status, response.headers, None
            chunks = []
            while chunk := response.read(65536):
                chunks.append(chunk)
            return response.status, response.headers, json.loads(b''.join(chunks))
        finally:
            response.close()


class NativeGitClient(AbstractHttpGitClient):
    """Dulwich smart fetch using a non-redirecting, non-proxy native HTTPS transport."""
    def __init__(self, url, payload, cancel, deadline, *, allow_push=False):
        safe_remote(url)
        super().__init__(url, dumb=False, thin_packs=True, quiet=True)
        self.url, self.payload, self.cancel, self.deadline = url, payload, cancel, deadline
        self.received = 0
        self.allow_push = allow_push

    def _http_request(self, url, headers=None, data=None, raise_for_status=True):
        # No dumb HTTP, bundles, packfile-URIs, redirects or auth callbacks.
        if (url == self.url + '/info/refs?service=git-upload-pack' or
                self.allow_push and url == self.url + '/info/refs?service=git-receive-pack') and data is None:
            route = url[len('https://github.com'):]
        elif url == self.url + '/git-upload-pack' and isinstance(data, bytes) and len(data) <= API_BYTES:
            route = url[len('https://github.com'):]
        elif self.allow_push and url == self.url + '/git-receive-pack' and data is not None:
            # Dulwich emits a pack iterator. Bound it before handing bytes to HTTPS.
            chunks, used = [], 0
            for chunk in ([data] if isinstance(data, bytes) else data):
                check(self.cancel, self.deadline)
                used += len(chunk)
                if used > MAX_PACK_BYTES:
                    raise ValueError('Git push pack size limit reached.')
                chunks.append(chunk)
            data = b''.join(chunks)
            route = url[len('https://github.com'):]
        else:
            raise ValueError('Git transport destination or operation refused.')
        supplied = headers or {}
        if set(supplied) - {'Accept', 'Content-Type', 'Git-Protocol', 'Content-Length'}:
            raise ValueError('Git transport headers refused.')
        auth = base64.b64encode(('x-access-token:' + self.payload['token']).encode()).decode('ascii')
        request_headers = {'User-Agent': 'Glitch', 'Authorization': 'Basic ' + auth} | supplied
        response = _Response('github.com', route, self.payload, self.cancel, self.deadline,
                             request_headers, data, MAX_PACK_BYTES - self.received)
        if response.status != 200 or not response.content_type or not response.content_type.startswith('application/x-git-'):
            response.close()
            raise ValueError('GitHub Git transport denied, redirected, or returned invalid data.')
        def read(size):
            chunk = response.read(size)
            self.received += len(chunk)
            return chunk
        return response, read


class SafeRepo(Repo):
    """No include/global config, hooks, external filter machinery, or worktree rebasing."""
    def get_config(self):
        path = Path(self._commondir) / 'config'
        data = bounded_read(path, API_BYTES) if path.exists() else b''
        config = ConfigFile.from_file(io.BytesIO(data), expand_includes=False)
        allowed = {b'core': {b'repositoryformatversion', b'bare', b'filemode', b'symlinks', b'ignorecase',
                             b'logallrefupdates', b'autocrlf', b'safecrlf', b'precomposeunicode'},
                   b'user': {b'name', b'email'}, b'remote': {b'url', b'fetch'},
                   b'branch': {b'remote', b'merge'}, b'init': {b'defaultbranch'}}
        for section in config.sections():
            if section[0].lower() not in allowed or any(key.lower() not in allowed[section[0].lower()]
                                                      for key, _ in config.items(section)):
                raise ValueError('Unsupported or unsafe repository configuration refused.')
            if section[0].lower() == b'remote':
                try:
                    safe_remote(config.get(section, b'url').decode('ascii'))
                except (KeyError, UnicodeError):
                    raise ValueError('Repository remote must be canonical GitHub HTTPS.') from None
        config.path = str(path)
        return config

    def get_config_stack(self):
        # Read structural local settings only; no credential helpers, filters or global config.
        return StackedConfig([self.get_config()])

    def get_blob_normalizer(self, config=None):
        return None


class _HostRefusal(ValueError):
    """Explicitly host-authored recovery text; never wrap parser/remote strings."""


def _local_errors(method):
    @wraps(method)
    def guarded(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (InterruptedError, TimeoutError):
            raise
        except (_HostRefusal, ResourceRefusal) as error:
            raise _HostRefusal(args[0].vault.redact(str(error))) from None
        except Exception:
            # Parser/object-store errors can echo file content; never expose their text.
            raise ValueError('Repository inspection failed or was refused; check paths, configuration and size limits.') from None
    return guarded


class GitHubService:
    def __init__(self, vault, *, http=None, git_factory=None):
        self.vault = vault
        self.http = http or NativeHTTP()
        self.git_factory = git_factory or NativeGitClient
        self.resources = SHARED_RESOURCES

    @contextmanager
    def _bounded_lease(self, workspace, cancel, deadline):
        expired = threading.Event()
        def expire():
            expired.set()
            cancel.set()
        timer = threading.Timer(max(0, deadline - time.monotonic()), expire)
        timer.daemon = True
        timer.start()
        try:
            with self.resources.lease('GitHub mutation', str(workspace), cancel):
                yield
        except InterruptedError:
            if expired.is_set() or time.monotonic() >= deadline:
                raise TimeoutError('Repository inspection exceeded its time limit.') from None
            raise
        finally:
            timer.cancel()
            timer.join(.2)

    def _payload(self, identifier):
        item = next((item for item in self.vault.list() if item['id'] == identifier), None)
        if not item or item['kind'] != 'github' or item['origin'] != 'https://github.com':
            raise ValueError('Choose a saved github.com GitHub token.')
        return self.vault.resolve(identifier, 'https://github.com')

    def _credential_version(self, identifier):
        self._payload(identifier)
        with self.vault.store.lock, self.vault.store.connect() as db:
            row = db.execute('SELECT ciphertext FROM vault WHERE id=?', (identifier,)).fetchone()
        if row is None:
            raise ValueError('GitHub credential was removed; bind again.')
        return digest(bytes(row['ciphertext']))

    def bind(self, workspace, credential_id, owner, name, cancel):
        """Native UI admission only. Models have no binding or destination override tool."""
        result = self.validate(credential_id, owner, name, cancel)
        if not result['ok']:
            raise ValueError('GitHub connection validation failed; validate access again.')
        default = result['repository']['default_branch']
        branch(default)
        for value in (owner, name, default):
            self._clean(value.encode())
        connection = {'credential_id': credential_id, 'credential_version': self._credential_version(credential_id),
                      'owner': owner, 'name': name, 'default_branch': default}
        deadline = time.monotonic() + LOCAL_DEADLINE
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                self._remote(repo, connection)
                if root.is_relative_to(self.vault.store.directory.resolve()):
                    raise ValueError('Application data cannot be a publishing workspace.')
                self.vault.store.bind_github(root, connection)
            finally:
                repo.close()
        return {'ok': True, 'repository': result['repository'], 'credential_id': credential_id}

    def connection(self, workspace):
        connection = self.vault.store.github_connection(workspace)
        if not connection:
            raise _HostRefusal('Bind this project to a validated GitHub connection in Settings first.')
        names(connection['owner'], connection['name'])
        branch(connection['default_branch'])
        if self._credential_version(connection['credential_id']) != connection['credential_version']:
            raise _HostRefusal('GitHub credential changed; validate and bind the project again.')
        return connection

    @staticmethod
    def _remote(repo, connection):
        config = repo.get_config()
        url = config.get((b'remote', b'origin'), b'url').decode('ascii')
        if safe_remote(url) != (connection['owner'], connection['name']):
            raise _HostRefusal('Checkout origin does not match the bound GitHub repository.')
        remotes = [s for s in config.sections() if s[0].lower() == b'remote']
        if remotes != [(b'remote', b'origin')]:
            raise _HostRefusal('Publishing requires a single canonical origin remote.')
        return url

    def _refs(self, url, payload, cancel, deadline):
        client = self.git_factory(url, payload, cancel, deadline)
        try:
            check(cancel, deadline)
            refs = client.get_refs(url, protocol_version=1).refs
            if len(refs) > MAX_FILES:
                raise ValueError('GitHub ref limit reached.')
            result = {}
            for ref, sha in refs.items():
                check(cancel, deadline)
                if ref.startswith(b'refs/heads/'):
                    safe_branch(ref)
                    if not isinstance(sha, bytes) or not re.fullmatch(b'[0-9a-f]{40}', sha):
                        raise ValueError('GitHub returned invalid ref data.')
                    result[ref] = sha
            return result
        finally:
            if hasattr(client, 'close'):
                client.close()

    def _branch_permission(self, connection, value, refs, payload, cancel, deadline):
        ref = branch(value)
        if value == connection['default_branch']:
            raise _HostRefusal('Publishing to the default branch is disabled.')
        prefix = f"/repos/{connection['owner']}/{connection['name']}"
        repository = self._repository(self._get(prefix, payload, cancel, deadline))
        if (repository['default_branch'] != connection['default_branch'] or
                repository['full_name'] != f"{connection['owner']}/{connection['name']}"):
            raise _HostRefusal('GitHub repository binding changed; validate and bind again.')
        data = self._get(prefix + '/branches/' + quote(value, safe=''), payload, cancel, deadline,
                         missing=ref not in refs)
        if data is not None and (not isinstance(data, dict) or data.get('protected') is not False):
            raise _HostRefusal('Protected branch or unverified branch protection refused.')

    def _clean(self, data):
        # latin-1 also preserves ASCII credential bytes in otherwise binary files.
        texts = [data.decode('latin-1')]
        try:
            texts.append(data.decode('utf-8'))
        except UnicodeDecodeError:
            pass
        if any(self.vault.redact(text) != text or re.search(
                r'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|(?i:password|api[_-]?key|secret|token)\s*[:=]\s*["\']?[^\s"\']{8,}',
                text) for text in texts):
            raise _HostRefusal('Detected credential content refused; no values are disclosed.')

    def _fingerprint(self, root, repo, connection, cancel, deadline):
        head, original, staged = self._snapshots(repo, cancel, deadline)
        records, total, nested = [], 0, []
        for path in sorted(self._scan(root, cancel=cancel, deadline=deadline, nested=nested)):
            check(cancel, deadline)
            name = path.relative_to(root).as_posix()
            file_path(name)
            data = bounded_read(path, MAX_FILE_BYTES)
            total += len(data)
            if total > MAX_CHECKOUT_BYTES:
                raise ValueError('Review byte limit reached.')
            info = path.stat()
            records.append((name, digest(data), info.st_mode, info.st_dev, info.st_ino))
        for path in nested:
            info = path.stat()
            records.append(('nested_checkout', path.relative_to(root).as_posix(), info.st_dev, info.st_ino))
        for name in ('HEAD', 'index', 'config', 'packed-refs'):
            path = root / '.git' / name
            records.append(('.git/' + name, digest(bounded_read(path, API_BYTES)) if path.exists() else None))
        for path in (root, root / '.git'):
            info = path.stat()
            records.append(('directory', str(path), info.st_dev, info.st_ino))
        refs = sorted((ref.decode(), sha.decode()) for ref, sha in repo.refs.as_dict().items())
        value = json.dumps([connection, head, refs, sorted(original.items()), sorted(staged.items()), records],
                           default=lambda b: b.decode('ascii'), sort_keys=True).encode()
        return digest(value), head, original, staged

    def _file_data(self, root, name):
        protected_path(name)
        self._clean(name.encode())
        path = self._repository_path(root, name)
        if path.is_dir():
            raise ValueError('Select explicit files, not directories.')
        data = bounded_read(path, MAX_FILE_BYTES) if path.exists() else None
        if data is not None:
            self._clean(data)
        return path, data

    @staticmethod
    def _repository_path(root, name):
        path = no_links(root.joinpath(*file_path(name)))
        for directory in path.parents:
            if directory == root:
                break
            if os.path.lexists(directory / '.git'):
                no_links(directory / '.git')
                raise _HostRefusal('Selected path belongs to a nested checkout; select that project for a new task.')
        return path

    def _commit_scan(self, repo, sha, cancel, deadline):
        """Scan history, not only selected working bytes: a prior commit also travels."""
        queue, seen, total = [sha], set(), 0
        while queue:
            check(cancel, deadline)
            current = queue.pop()
            if current in seen:
                continue
            seen.add(current)
            if len(seen) > MAX_COMMITS:
                raise ValueError('Publishing history scan limit reached.')
            commit = repo.object_store[current]
            if not isinstance(commit, Commit) or commit.id != current or commit.raw_length() > MAX_FILE_BYTES:
                raise ValueError('Publishing requires valid commit history.')
            self._clean(commit.as_raw_string())
            queue.extend(commit.parents)
            count, spelling = 0, {}
            for entry in iter_tree_contents(repo.object_store, commit.tree):
                check(cancel, deadline)
                protected_path(entry.path.decode('utf-8'))
                self._clean(entry.path)
                parts = file_path(entry.path.decode('utf-8'))
                for length in range(1, len(parts) + 1):
                    prefix = '/'.join(parts[:length])
                    if spelling.setdefault(prefix.casefold(), prefix) != prefix:
                        raise ValueError('Publishing Windows path collision refused.')
                count += 1
                if count > MAX_FILES or entry.mode not in (0o100644, 0o100755):
                    raise ValueError('Publishing tree limit or unsupported file mode.')
                obj = repo.object_store[entry.sha]
                if not isinstance(obj, Blob) or obj.id != entry.sha or obj.raw_length() > MAX_FILE_BYTES:
                    raise ValueError('Publishing file scan limit reached.')
                total += obj.raw_length()
                if total > MAX_CHECKOUT_BYTES:
                    raise ValueError('Publishing content scan limit reached.')
                self._clean(obj.data)

    @staticmethod
    def _ancestor(repo, ancestor, head, cancel, deadline):
        queue, seen = [head], set()
        while queue:
            check(cancel, deadline)
            sha = queue.pop()
            if sha == ancestor:
                return True
            if sha in seen:
                continue
            seen.add(sha)
            if len(seen) > MAX_COMMITS:
                raise ValueError('Ancestry check limit reached.')
            try:
                queue.extend(repo.object_store[sha].parents)
            except KeyError:
                return False
        return False

    @_local_errors
    def prepare(self, workspace, name, args, cancel):
        deadline = time.monotonic() + LOCAL_DEADLINE
        connection = self.connection(workspace)
        payload = self._payload(connection['credential_id'])
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                url = self._remote(repo, connection)
                fingerprint, head, original, staged = self._fingerprint(root, repo, connection, cancel, deadline)
                refs = self._refs(url, payload, cancel, deadline)
                preview = {'repository': f"{connection['owner']}/{connection['name']}",
                           'workspace': str(root), 'head': head, 'current_head': head, 'fingerprint': fingerprint,
                           'operation': name, **args}
                if name == 'github_clone_repo':
                    destination = no_links(root / args['folder'])
                    self._clean(str(destination).encode())
                    preview.update(clone_destination=str(destination), continuation_required=True,
                        continuation='Current run keeps its workspace and pauses after clone. Select the new child conversation for a new task.')
                if name != 'github_clone_repo':
                    value = args.get('branch', args.get('head'))
                    self._branch_permission(connection, value, refs, payload, cancel, deadline)
                if name in ('github_create_branch', 'github_commit_and_push'):
                    if original != staged:
                        raise _HostRefusal('Preexisting staged changes are ambiguous; review or unstage them first.')
                    if not head:
                        raise _HostRefusal('An initial repository commit is required.')
                if name == 'github_create_branch':
                    ref = branch(args['branch'])
                    for path, (sha, _) in staged.items():
                        local = no_links(root.joinpath(*file_path(path)))
                        if not local.is_file() or Blob.from_string(bounded_read(local, MAX_FILE_BYTES)).id != sha:
                            raise _HostRefusal('Tracked working files must be clean before changing branches.')
                    incoming = refs.get(ref)
                    if incoming:
                        client = self.git_factory(url, payload, cancel, deadline)
                        try:
                            fetched = client.fetch(url, repo, protocol_version=1, ref_prefix=[ref],
                                                   progress=lambda _: check(cancel, deadline))
                            if fetched.refs.get(ref) != incoming:
                                raise _HostRefusal('Remote changed during fetch; review again.')
                        finally:
                            if hasattr(client, 'close'):
                                client.close()
                        old = repo.refs[ref] if ref in repo.refs else None
                        if old and not self._ancestor(repo, old, incoming, cancel, deadline):
                            raise _HostRefusal('Divergent feature branch refused; no reset, rebase or merge.')
                        self._commit_scan(repo, incoming, cancel, deadline)
                        entries = self._branch_entries(root, repo, incoming, original, cancel, deadline)
                        preview.update(target_head=incoming.decode(), paths=sorted(original.keys() | entries.keys()),
                                       diff=self._branch_diff(root, repo, original, entries, cancel, deadline))
                    elif ref in repo.refs:
                        raise _HostRefusal('Local branch exists without a matching remote; choose a new feature branch.')
                if name == 'github_commit_and_push':
                    if repo.refs.read_ref(b'HEAD') != b'ref: ' + branch(args['branch']):
                        raise _HostRefusal('Selected publishing branch must be the current branch.')
                    self._clean((args['title'] + '\n\n' + args['body']).encode())
                    settings = self.vault.store.settings()
                    author = settings['github_author_name'] + ' <' + settings['github_author_email'] + '>'
                    if not settings['github_author_name'] or not settings['github_author_email']:
                        raise _HostRefusal('Save the GitHub author name and email in Settings first.')
                    self._clean(author.encode())
                    preview['author'] = author
                    self._commit_scan(repo, head.encode(), cancel, deadline)
                    receipt = self.vault.store.github_publication(connection['project'], args['branch'])
                    matching = (receipt and receipt['sha'] == head and
                                receipt['request_hash'] == digest(json.dumps(args, sort_keys=True).encode()))
                    baseline = refs.get(branch(args['branch']), refs.get(branch(connection['default_branch'])))
                    if head.encode() != baseline and not matching:
                        raise _HostRefusal('Unreviewed local commits exist; only a matching retained publication can be retried.')
                    review_original = original
                    if matching:
                        commit = repo.object_store[head.encode()]
                        if len(commit.parents) != 1:
                            raise ValueError('Retained publication history is invalid.')
                        parent = repo.object_store[commit.parents[0]]
                        review_original = {entry.path.decode('utf-8'): (entry.sha, entry.mode)
                            for entry in iter_tree_contents(repo.object_store, parent.tree)}
                        preview['retained_commit'] = head
                    preview['diff'] = self._review_diff(root, repo, review_original, args['paths'], cancel, deadline)
                if name == 'github_create_pull_request':
                    branch(args['base'])
                    if args['base'] == args['head'] or branch(args['base']) not in refs:
                        raise _HostRefusal('Choose a distinct existing base branch.')
                    if refs.get(branch(args['head'])) != (head or '').encode():
                        raise _HostRefusal('PR head must match the current published local commit.')
                    self._clean((args['title'] + '\n\n' + args['body']).encode())
                    self._commit_scan(repo, head.encode(), cancel, deadline)
                return PublicationReview(name, json.dumps(args, sort_keys=True), json.dumps(connection, sort_keys=True),
                    fingerprint, tuple(sorted(refs.items())), json.dumps(self.vault.redact(preview)))
            finally:
                repo.close()

    def _branch_entries(self, root, repo, sha, original, cancel, deadline):
        entries, spelling = {}, {}
        commit = repo.object_store[sha]
        for entry in iter_tree_contents(repo.object_store, commit.tree):
            check(cancel, deadline)
            name = entry.path.decode('utf-8')
            parts = file_path(name)
            for length in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:length])
                if spelling.setdefault(prefix.casefold(), prefix) != prefix:
                    raise ValueError('Windows tree spelling collision refused.')
            path = no_links(root.joinpath(*parts))
            if name not in original and path.exists():
                raise ValueError('Incoming branch would overwrite an untracked file or directory.')
            if any(parent.is_file() for parent in path.parents if parent != root):
                raise ValueError('Incoming branch conflicts with an existing file directory.')
            entries[name] = (entry.sha, entry.mode)
        return entries

    def _branch_diff(self, root, repo, original, entries, cancel, deadline):
        output, used = [], 0
        for name in sorted(original.keys() | entries.keys()):
            check(cancel, deadline)
            old, new = original.get(name), entries.get(name)
            if old == new:
                continue
            before = repo.object_store[old[0]].data if old else b''
            after = repo.object_store[new[0]].data if new else b''
            try:
                a, b = self.vault.redact(before.decode('utf-8')), self.vault.redact(after.decode('utf-8'))
            except UnicodeDecodeError:
                raise ValueError('Binary branch review is unsupported.') from None
            if '\0' in a + b or len(a) + len(b) > 256 * 1024 or a.count('\n') + b.count('\n') > 2000:
                raise ValueError('Branch review work limit reached.')
            lines = difflib.unified_diff(a.splitlines(True), b.splitlines(True), 'a/' + name, 'b/' + name)
            for line in lines:
                used += len(line.encode())
                if used > MAX_DIFF_BYTES:
                    raise ValueError('Complete branch review exceeds the approval limit.')
                output.append(line)
            if before == after:
                output.append(f'Existence or mode change: {name}\n')
        return ''.join(output)

    def _install_branch(self, root, repo, original, entries, cancel, deadline):
        index = Index(root / '.git/index', read=False, object_format=repo.object_format)
        for name in sorted(original.keys() - entries.keys()):
            check(cancel, deadline)
            no_links(root.joinpath(*file_path(name))).unlink()
        for name, (sha, mode) in sorted(entries.items()):
            check(cancel, deadline)
            path = no_links(root.joinpath(*file_path(name)))
            if original.get(name) != (sha, mode):
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = None
                try:
                    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(repo.object_store[sha].data)
                    no_links(path)
                    os.replace(temporary, path)
                    temporary = None
                finally:
                    if temporary is not None:
                        temporary.unlink(missing_ok=True)
            index[name.encode()] = index_entry_from_stat(path.stat(), sha, mode)
        index.write()

    def _review_diff(self, root, repo, original, paths, cancel, deadline):
        output = []
        used = 0
        for name in paths:
            check(cancel, deadline)
            _, data = self._file_data(root, name)
            entry = original.get(name)
            before = repo.object_store[entry[0]].data if entry else b''
            if len(before) > MAX_FILE_BYTES:
                raise ValueError('Review source size limit reached.')
            self._clean(before)
            data = data if data is not None else b''
            try:
                # Complete bounded source is protected before any segmentation/truncation.
                a, b = self.vault.redact(before.decode('utf-8')), self.vault.redact(data.decode('utf-8'))
            except UnicodeDecodeError:
                raise ValueError('Binary publishing review is unsupported; select text files.') from None
            if '\0' in a or '\0' in b or len(a) + len(b) > 256 * 1024 or a.count('\n') + b.count('\n') > 2000:
                raise ValueError('Complete text review exceeds its work limit.')
            if a == b:
                lines = [f'File existence review: {name}\n']
            else:
                lines = difflib.unified_diff(a.splitlines(True), b.splitlines(True), 'a/' + name, 'b/' + name)
            for line in lines:
                used += len(line.encode())
                if used > MAX_DIFF_BYTES:
                    raise _HostRefusal('Complete approval diff exceeds its limit; select fewer paths.')
                output.append(line)
        return ''.join(output)

    def _recheck(self, root, repo, review, cancel, deadline):
        connection = self.connection(root)
        if json.dumps(connection, sort_keys=True) != review.connection:
            raise _HostRefusal('Project binding changed while approval was pending.')
        url = self._remote(repo, connection)
        fingerprint, head, original, staged = self._fingerprint(root, repo, connection, cancel, deadline)
        if fingerprint != review.fingerprint:
            raise _HostRefusal('Repository HEAD, index or file bytes changed; review and approve again.')
        payload = self._payload(connection['credential_id'])
        refs = self._refs(url, payload, cancel, deadline)
        if tuple(sorted(refs.items())) != review.remote_refs:
            raise _HostRefusal('Remote refs changed while approval was pending; review again.')
        args = json.loads(review.arguments)
        if review.name != 'github_clone_repo':
            self._branch_permission(connection, args.get('branch', args.get('head')), refs, payload, cancel, deadline)
        # Permission requests are another network interval. Check refs/binding
        # again after them before the final local fingerprint and mutation.
        if tuple(sorted(self._refs(url, payload, cancel, deadline).items())) != review.remote_refs:
            raise _HostRefusal('Remote refs changed during the final permission check; review again.')
        if json.dumps(self.connection(root), sort_keys=True) != review.connection:
            raise _HostRefusal('Project binding changed during the final permission check; review again.')
        if self._fingerprint(root, repo, connection, cancel, deadline)[0] != review.fingerprint:
            raise _HostRefusal('Repository changed during the final remote check; review again.')
        check(cancel, deadline)
        return connection, payload, url, refs, head, original, staged

    @_local_errors
    def mutate(self, workspace, review, cancel):
        deadline = time.monotonic() + CLONE_DEADLINE
        args = json.loads(review.arguments)
        if review.name == 'github_clone_repo':
            connection = json.loads(review.connection)
            # Hold the approved parent scope through clone and child registration.
            # The clone's nested lease is reentrant and never spans human review.
            with self._bounded_lease(workspace, cancel, deadline):
                root, repo = self._open(workspace, cancel, deadline)
                try:
                    self._recheck(root, repo, review, cancel, deadline)
                finally:
                    repo.close()
                destination = no_links(root / args['folder'])
                result = self.clone(connection['credential_id'], connection['owner'], connection['name'],
                    root, args['folder'], cancel, lease_workspace=root)
                result.update(active_workspace=str(root), clone_workspace=str(destination), continuation_required=True,
                    message='Clone created for a new task. Active workspace is unchanged; select the new child conversation before continuing.')
                try:
                    result.update(self.vault.store.register_github_clone(destination, connection))
                except Exception:
                    result.update(ok=False, clone_retained=True,
                        error='Clone retained, but child task registration failed. Select the cloned folder through the native picker before continuing.')
                return result
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                connection, payload, url, refs, head, original, staged = self._recheck(root, repo, review, cancel, deadline)
                if review.name == 'github_create_branch':
                    ref = branch(args['branch'])
                    incoming = refs.get(ref)
                    old = repo.refs[ref] if ref in repo.refs else None
                    if incoming:
                        entries = self._branch_entries(root, repo, incoming, original, cancel, deadline)
                        self._install_branch(root, repo, original, entries, cancel, deadline)
                        if not (repo.refs.add_if_new(ref, incoming) if old is None else
                                repo.refs.set_if_equals(ref, old, incoming)):
                            raise ValueError('Branch changed before fast-forward update; inspect local state.')
                        head = incoming.decode()
                    elif not repo.refs.add_if_new(ref, head.encode()):
                        raise ValueError('Branch changed before creation.')
                    repo.refs.set_symbolic_ref(b'HEAD', ref)
                    return {'ok': True, 'branch': args['branch'], 'head': head}
                if review.name == 'github_create_pull_request':
                    return self._pull_request(root, repo, review, connection, args, payload, cancel, deadline)
                return self._publish(root, repo, connection, payload, url, refs, head, args, review, cancel, deadline)
            finally:
                repo.close()

    def _publish(self, root, repo, connection, payload, url, refs, head, args, review, cancel, deadline):
        ref = branch(args['branch'])
        request_hash = digest(review.arguments.encode())
        receipt = self.vault.store.github_publication(connection['project'], args['branch'])
        index = repo.open_index()
        changed = False
        for name in args['paths']:
            path, data = self._file_data(root, name)
            key = name.encode()
            if data is None:
                if key in index:
                    del index[key]
                    changed = True
            else:
                blob = Blob.from_string(data)
                prior = index[key] if key in index else None
                if prior is None or prior.sha != blob.id:
                    changed = True
                repo.object_store.add_object(blob)
                index[key] = index_entry_from_stat(path.stat(), blob.id, prior.mode if prior else 0o100644)
        retry = receipt and receipt['request_hash'] == request_hash and receipt['sha'] == head
        if not changed and not retry:
            raise _HostRefusal('No selected changes and no matching retained commit to retry.')
        old_remote = refs.get(ref)
        if old_remote and not self._ancestor(repo, old_remote, head.encode(), cancel, deadline):
            raise _HostRefusal('Remote divergence refused; only fast-forward publishing is allowed.')
        if changed:
            if receipt and receipt['sha'] == head and old_remote != head.encode():
                raise _HostRefusal('A retained unpublished commit exists; retry it before editing these paths.')
            commit = Commit()
            commit.tree = index.commit(repo.object_store)
            commit.parents = [head.encode()]
            author = json.loads(review.preview)['author'].encode()
            commit.author = commit.committer = author
            commit.author_time = commit.commit_time = int(time.time())
            commit.author_timezone = commit.commit_timezone = 0
            commit.message = (args['title'] + '\n\n' + args['body']).rstrip().encode() + b'\n'
            repo.object_store.add_object(commit)
            self._commit_scan(repo, commit.id, cancel, deadline)
            check(cancel, deadline)
            self._recheck(root, repo, review, cancel, deadline)
            # Journal before installing HEAD so a crash cannot leave an unidentifiable commit.
            self.vault.store.record_github_publication(connection['project'], args['branch'], request_hash, commit.id.decode())
            if not repo.refs.set_if_equals(ref, head.encode(), commit.id):
                raise ValueError('HEAD changed before committing; commit was not installed.')
            head = commit.id.decode()
            try:
                index.write()
            except Exception:
                return {'ok': False, 'head': head, 'local_commit_retained': True,
                    'error': 'Local commit retained, but the index update failed. Inspect the index before retrying; nothing was pushed.'}
        self._commit_scan(repo, head.encode(), cancel, deadline)
        check(cancel, deadline)
        if old_remote == head.encode():
            return {'ok': True, 'head': head, 'branch': args['branch'], 'reconciled': True}
        push_fingerprint = self._fingerprint(root, repo, connection, cancel, deadline)[0]
        client = None
        try:
            client = self.git_factory(url, payload, cancel, deadline)
            if isinstance(client, NativeGitClient):
                client.allow_push = True
            def update(remote):
                check(cancel, deadline)
                if remote.get(ref) != old_remote:
                    raise ValueError('Remote changed before push; no override is allowed.')
                self._branch_permission(connection, args['branch'], remote, payload, cancel, deadline)
                if (self.connection(root) != connection or
                        self._fingerprint(root, repo, connection, cancel, deadline)[0] != push_fingerprint):
                    raise ValueError('Local state or credential changed before push; retained commit was not sent.')
                check(cancel, deadline)
                return {ref: head.encode()}
            def pack(have, want, **kwargs):
                check(cancel, deadline)
                count, records = repo.object_store.generate_pack_data(have, want, **kwargs)
                if count > MAX_FILES:
                    raise ValueError('Push object limit reached.')
                def bounded():
                    for record in records:
                        check(cancel, deadline)
                        yield record
                return count, bounded()
            result = client.send_pack(url, update, pack, progress=lambda _: check(cancel, deadline))
            if any(status is not None for status in (result.ref_status or {}).values()):
                raise ValueError('Remote rejected the push.')
        except Exception:
            check(cancel, deadline)
            # Never blindly send again: a lost response can still mean remote success.
            try:
                if self._refs(url, payload, cancel, deadline).get(ref) == head.encode():
                    return {'ok': True, 'head': head, 'branch': args['branch'], 'reconciled': True}
            except (InterruptedError, TimeoutError):
                raise
            except Exception:
                pass
            return {'ok': False, 'head': head, 'local_commit_retained': True,
                    'error': 'Push failed or its response was lost. Local commit retained; retry the same reviewed request.'}
        finally:
            if client is not None and hasattr(client, 'close'):
                client.close()
        return {'ok': True, 'head': head, 'branch': args['branch']}

    def _pull_request(self, root, repo, review, connection, args, payload, cancel, deadline):
        prefix = f"/repos/{connection['owner']}/{connection['name']}/pulls"
        query = urlencode({'state': 'all', 'head': connection['owner'] + ':' + args['head'],
                           'base': args['base'], 'per_page': 100}, quote_via=quote)
        approved_refs = dict(review.remote_refs)
        def revalidate():
            return self._recheck(root, repo, review, cancel, deadline)[1]

        def search(expected=None):
            data = self._get(prefix + '?' + query, payload, cancel, deadline)
            if not isinstance(data, list) or len(data) >= 100:
                raise _HostRefusal('GitHub PR search result limit or invalid data.')
            match = None
            for item in data:
                identity = self._pr_identity(item, connection)
                if not self._pr_branches(item, connection, args) or item.get('state') not in ('open', 'closed'):
                    raise _HostRefusal('GitHub returned inconsistent PR repository or branch identity.')
                if item['state'] == 'closed':
                    continue
                if not self._matching_pr(item, connection, args, approved_refs):
                    raise _HostRefusal('GitHub PR lookup returned stale head/base state; refresh and review again.')
                if expected is None or identity == expected:
                    if match is not None:
                        raise _HostRefusal('GitHub returned ambiguous matching open PRs; inspect the repository.')
                    match = item
            return match

        existing = search()
        # A lookup is a network interval, not a frozen-ref reservation. Validate
        # after it, immediately before POST or reuse of an existing open PR.
        payload = revalidate()
        if existing:
            return self._pr_result(existing, connection)
        check(cancel, deadline)
        data, expected = None, None
        problem = 'PR response was lost; inspect GitHub before retrying.'
        try:
            data = self._get(prefix, payload, cancel, deadline, body=args)
            expected = self._pr_identity(data, connection)
            if not self._matching_pr(data, connection, args, approved_refs):
                raise _HostRefusal('GitHub returned a terminal or mismatched PR; creation outcome is uncertain.')
            revalidate()
            return self._pr_result(data, connection)
        except (InterruptedError, TimeoutError):
            raise
        except _HostRefusal as error:
            problem = str(error)
        except Exception:
            check(cancel, deadline)
        try:
            existing = search(expected)
            revalidate()
            # A received response with invalid identity cannot be attributed to
            # a different PR found later. A lost response has no known identity.
            if existing and (data is None or expected is not None):
                return self._pr_result(existing, connection)
        except (InterruptedError, TimeoutError):
            raise
        except _HostRefusal as error:
            problem = str(error)
        except Exception:
            check(cancel, deadline)
        return {'ok': False, 'uncertain_creation': True,
                'error': 'PR request may have reached GitHub. ' + problem}

    @staticmethod
    def _pr_branches(item, connection, args):
        full = f"{connection['owner']}/{connection['name']}"
        return (isinstance(item, dict) and all(isinstance(item.get(side), dict) and
            item[side].get('ref') == args[side] and isinstance(item[side].get('repo'), dict) and
            item[side]['repo'].get('full_name') == full for side in ('head', 'base')))

    @staticmethod
    def _matching_pr(item, connection, args, approved_refs):
        return (GitHubService._pr_branches(item, connection, args) and item.get('state') == 'open' and
                item.get('merged') is not True and item.get('closed_at') is None and all(
                    item[side].get('sha') == approved_refs[branch(args[side])].decode()
                    for side in ('head', 'base')))

    @staticmethod
    def _pr_identity(item, connection):
        if not isinstance(item, dict):
            raise _HostRefusal('GitHub returned invalid PR identity.')
        identifier, number = item.get('id'), item.get('number')
        url = f"https://github.com/{connection['owner']}/{connection['name']}/pull/{number}"
        if (type(identifier) is not int or identifier < 1 or type(number) is not int or
                number < 1 or item.get('html_url') != url):
            raise _HostRefusal('GitHub returned invalid PR identity.')
        return identifier, number, url

    @staticmethod
    def _pr_result(item, connection):
        identifier, number, url = GitHubService._pr_identity(item, connection)
        return {'ok': True, 'number': number, 'url': url, 'pr_id': identifier, 'pr_state': 'open',
                'head': item['head']['sha']}

    def _get(self, endpoint, payload, cancel, deadline, *, body=None, missing=False):
        check(cancel, deadline)
        try:
            code, headers, data = (self.http(endpoint, payload, cancel, deadline) if body is None else
                                  self.http(endpoint, payload, cancel, deadline, body=body))
            check(cancel, deadline)
            if code == 401:
                raise _HostRefusal('GitHub token is invalid or expired; replace the saved token.')
            if code in (403, 429):
                limited = code == 429 or any(k.lower() == 'x-ratelimit-remaining' and str(v) == '0'
                                           for k, v in headers.items()) or any(k.lower() == 'retry-after' for k in headers)
                raise _HostRefusal('GitHub rate limit reached; retry later.' if limited else
                                 'GitHub access denied. Check token permissions and organization approval.')
            if code == 404:
                if missing:
                    return None
                raise _HostRefusal('GitHub repository or account unavailable; check access and spelling.')
            if 300 <= code < 400:
                raise _HostRefusal('GitHub redirect refused. Select the canonical repository.')
            if code != (201 if body is not None else 200):
                raise _HostRefusal('GitHub service returned an unsuccessful response.')
            if len(json.dumps(data, allow_nan=False).encode()) > API_BYTES:
                raise _HostRefusal('GitHub response exceeded its size limit.')
            return data
        except InterruptedError:
            raise
        except ssl.SSLError:
            raise _HostRefusal('GitHub TLS verification failed. Check the trusted CA.') from None
        except (TimeoutError, socket.timeout):
            check(cancel, deadline)
            raise _HostRefusal('GitHub request timed out.') from None
        except _HostRefusal:
            raise
        except ValueError:
            raise _HostRefusal('GitHub returned invalid response data.') from None
        except Exception:
            check(cancel, deadline)
            raise _HostRefusal('GitHub connection failed. Check network and certificate trust.') from None

    @staticmethod
    def _repository(data):
        if not isinstance(data, dict) or not isinstance(data.get('owner'), dict):
            raise ValueError('GitHub returned invalid repository data.')
        owner, repo = names(data['owner'].get('login'), data.get('name'))
        if data.get('full_name', '').lower() != f'{owner}/{repo}'.lower():
            raise ValueError('GitHub returned inconsistent repository identity.')
        branch = data.get('default_branch')
        if branch is not None and (not isinstance(branch, str) or len(branch) > 200 or
                                   not check_ref_format(('refs/heads/' + branch).encode())):
            raise ValueError('GitHub returned invalid branch data.')
        if branch is not None:
            safe_branch(('refs/heads/' + branch).encode())
        return {'owner': owner, 'name': repo, 'full_name': f'{owner}/{repo}', 'private': bool(data.get('private')),
                'default_branch': branch, 'url': f'https://github.com/{owner}/{repo}'}

    def validate(self, credential_id, owner, repo, cancel):
        names(owner, repo)
        check(cancel, float('inf'))
        payload = self._payload(credential_id)
        deadline = time.monotonic() + API_DEADLINE
        try:
            account = self._get('/user', payload, cancel, deadline)
            if (not isinstance(account, dict) or not isinstance(account.get('id'), int) or
                    not isinstance(account.get('login'), str) or
                    not re.fullmatch(r'[A-Za-z0-9-]{1,39}', account['login'])):
                raise ValueError('GitHub returned invalid account data.')
            repository = self._repository(self._get(f'/repos/{owner}/{repo}', payload, cancel, deadline))
            if repository['full_name'].lower() != f'{owner}/{repo}'.lower():
                raise ValueError('GitHub repository identity changed; select its canonical name.')
            result = {'ok': True, 'account': {'login': account['login'], 'id': account['id']},
                      'repository': repository, 'credential_id': credential_id,
                      'permissions': {'read_verified': True, 'contents_write': None, 'pull_requests_write': None},
                      'message': 'Identity and repository read verified. Contents write and Pull requests write are unverified.'}
        except ValueError as error:
            result = {'ok': False, 'error': str(error)}
        return self.vault.redact(result, GITHUB_RESULT)

    def repositories(self, credential_id, cancel):
        check(cancel, float('inf'))
        payload = self._payload(credential_id)
        deadline = time.monotonic() + API_DEADLINE
        repositories = {}
        for page in range(1, MAX_PAGES + 1):
            data = self._get(f'/user/repos?per_page=100&page={page}', payload, cancel, deadline)
            if not isinstance(data, list) or len(data) > 100:
                raise ValueError('GitHub returned invalid repository page data.')
            for item in data:
                repository = self._repository(item)
                repositories[repository['full_name'].lower()] = repository
            if len(data) < 100:
                return self.vault.redact(list(repositories.values()), [GITHUB_REPOSITORY])
        raise ValueError('GitHub repository page limit reached; use an owner and repository directly.')

    @staticmethod
    def _owned(path, identity, parent):
        try:
            no_links(parent)
            no_links(path)
            info = path.lstat()
            return (info.st_dev, info.st_ino) == identity and path.parent == parent and path.is_dir()
        except (OSError, ValueError):
            return False

    def clone(self, credential_id, owner, repo, parent, folder, cancel, *, lease_workspace=None, before=None):
        names(owner, repo)
        if len(file_path(folder)) != 1:
            raise ValueError('Clone into a single new child directory.')
        parent = no_links(parent)
        if not parent.is_dir():
            raise ValueError('Choose an existing local clone parent directory.')
        destination = parent / folder
        check(cancel, float('inf'))
        if os.path.lexists(destination):
            raise ValueError('Clone destination already exists; choose a new directory.')
        payload = self._payload(credential_id)
        url = f'https://github.com/{owner}/{repo}.git'
        deadline = time.monotonic() + CLONE_DEADLINE
        with self._bounded_lease(lease_workspace or destination, cancel, deadline):
            if before:
                before()
            no_links(parent)
            destination.mkdir(exist_ok=False)
            info = destination.lstat()
            identity = (info.st_dev, info.st_ino)
            target = None
            client = None
            try:
                target = SafeRepo.init(destination, config=StackedConfig([]), default_branch=b'main', symlinks=False)
                target.hooks.clear()
                client = self.git_factory(url, payload, cancel, deadline)
                result = client.fetch(url, target, progress=lambda _: check(cancel, deadline),
                                      protocol_version=1, ref_prefix=[b'HEAD', b'refs/heads/'])
                check(cancel, deadline)
                if not self._owned(destination, identity, parent):
                    raise ValueError('Clone destination ownership changed; partial data retained.')
                head = result.refs.get(b'HEAD')
                branch = result.symrefs.get(b'HEAD', b'refs/heads/main')
                safe_branch(branch)
                for ref, sha in result.refs.items():
                    check(cancel, deadline)
                    if ref.startswith(b'refs/heads/') and sha is not None and check_ref_format(ref):
                        safe_branch(ref)
                        target.refs[b'refs/remotes/origin/' + ref[len(b'refs/heads/'):]] = sha
                target.refs.set_symbolic_ref(b'HEAD', branch)
                if head is not None:
                    target.refs[branch] = head
                    self._checkout(target, head, destination, cancel, deadline)
                else:
                    Index(destination / '.git/index', read=False).write()
                config = target.get_config()
                config.set((b'remote', b'origin'), b'url', url.encode())
                config.set((b'remote', b'origin'), b'fetch', b'+refs/heads/*:refs/remotes/origin/*')
                config.set((b'branch', branch[len(b'refs/heads/'):]), b'remote', b'origin')
                config.set((b'branch', branch[len(b'refs/heads/'):]), b'merge', branch)
                config.write_to_path()
                check(cancel, deadline)
                return self.vault.redact({'ok': True, 'workspace': str(destination), 'credential_id': credential_id,
                    'repository': {'owner': owner, 'name': repo, 'full_name': f'{owner}/{repo}', 'url': url}}, GITHUB_RESULT)
            except BaseException as error:
                if target is not None:
                    target.close()
                    target = None
                cleaned = False
                if self._owned(destination, identity, parent):
                    try:
                        self._scan(destination, cancel=threading.Event(), deadline=time.monotonic() + LOCAL_DEADLINE, metadata=True)
                        shutil.rmtree(destination)
                        cleaned = True
                    except (OSError, ValueError, TimeoutError):
                        pass
                if isinstance(error, InterruptedError):
                    raise InterruptedError('Clone cancelled.' + ('' if cleaned else ' Partial destination retained; inspect it manually.')) from None
                raise ValueError('GitHub clone failed or was refused.' +
                                 ('' if cleaned else ' Partial destination retained; inspect it manually.')) from None
            finally:
                if target is not None:
                    target.close()
                if client is not None and hasattr(client, 'close'):
                    client.close()

    @staticmethod
    def _checkout(repo, head, root, cancel, deadline):
        commit = repo.object_store[head]
        if not isinstance(commit, Commit):
            raise ValueError('GitHub HEAD is not a commit.')
        entries, seen, spelling, total = [], set(), {}, 0
        for entry in iter_tree_contents(repo.object_store, commit.tree):
            check(cancel, deadline)
            name = entry.path.decode('utf-8', errors='strict')
            parts = file_path(name)
            if entry.mode not in (0o100644, 0o100755) or name.casefold() in seen:
                raise ValueError('Symlinks, submodules and Windows path collisions are refused.')
            for length in range(1, len(parts) + 1):
                prefix = '/'.join(parts[:length])
                previous = spelling.setdefault(prefix.casefold(), prefix)
                if previous != prefix:
                    raise ValueError('Windows directory spelling collision refused.')
            seen.add(name.casefold())
            blob = repo.object_store[entry.sha]
            if not isinstance(blob, Blob):
                raise ValueError('Invalid repository file object.')
            total += blob.raw_length()
            if len(entries) >= MAX_FILES or total > MAX_CHECKOUT_BYTES or blob.raw_length() > MAX_FILE_BYTES:
                raise ValueError('Clone checkout exceeds file or byte limits.')
            entries.append((entry, name))
        index = Index(root / '.git/index', read=False, object_format=repo.object_format)
        for entry, name in entries:
            check(cancel, deadline)
            path = root.joinpath(*file_path(name))
            no_links(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                stream.write(repo.object_store[entry.sha].data)
            index[entry.path] = index_entry_from_stat(path.stat(), entry.sha, entry.mode)
        index.write()

    @staticmethod
    def _scan(root, *, cancel, deadline, metadata=False, nested=None):
        """Bound traversal and reject reparse points before Dulwich reads local metadata."""
        no_links(root)
        count = 0
        files = []
        for directory, dirs, names_in_dir in os.walk(root, followlinks=False):
            check(cancel, deadline)
            if not metadata and Path(directory) == root:
                dirs[:] = [name for name in dirs if name != '.git']
            for name in [*dirs, *names_in_dir]:
                check(cancel, deadline)
                path = Path(directory) / name
                no_links(path)
                count += 1
                if count > MAX_FILES:
                    raise ValueError('Repository entry limit reached.')
                if not metadata and name in dirs and os.path.lexists(path / '.git'):
                    no_links(path / '.git')
                    dirs.remove(name)
                    if nested is not None:
                        nested.append(path)
                    continue
                if path.is_file():
                    files.append(path)
        return files

    def _open(self, workspace, cancel, deadline):
        root = no_links(workspace)
        git = root / '.git'
        if not git.is_dir():
            raise ValueError('Choose a local checkout with an in-workspace .git directory.')
        self._scan(git, cancel=cancel, deadline=deadline, metadata=True)
        hooks = git / 'hooks'
        if hooks.exists() and any(p.is_file() and not p.name.endswith('.sample') for p in hooks.iterdir()):
            raise ValueError('Active repository hooks are refused.')
        for path in ('commondir', 'gitdir', 'objects/info/alternates', 'objects/info/http-alternates'):
            if (git / path).exists():
                raise ValueError('External repository metadata or object stores are refused.')
        for path in ('config', 'index', 'HEAD', 'packed-refs'):
            if (git / path).is_file() and (git / path).stat().st_size > API_BYTES:
                raise ValueError('Repository metadata size limit reached.')
        repo = SafeRepo(root, controldir=git, commondir=git, worktree=root, bare=False)
        repo.hooks.clear()
        return root, repo

    @staticmethod
    def _snapshots(repo, cancel, deadline):
        index = repo.open_index()
        if len(index) > MAX_FILES:
            raise ValueError('Repository index entry limit reached.')
        staged = {}
        for path, entry in index.items():
            check(cancel, deadline)
            name = path.decode('utf-8')
            file_path(name)
            if not hasattr(entry, 'sha') or entry.mode not in (0o100644, 0o100755):
                raise ValueError('Unmerged, symlink or submodule index entries are unsupported.')
            staged[name] = (entry.sha, entry.mode)
        try:
            head = repo.head()
        except KeyError:
            return None, {}, staged
        commit = repo.object_store[head]
        if not isinstance(commit, Commit):
            raise ValueError('Repository HEAD is not a commit.')
        original = {}
        for entry in iter_tree_contents(repo.object_store, commit.tree):
            check(cancel, deadline)
            name = entry.path.decode('utf-8')
            file_path(name)
            if len(original) >= MAX_FILES or entry.mode not in (0o100644, 0o100755):
                raise ValueError('Repository tree entry limit or unsupported mode.')
            original[name] = (entry.sha, entry.mode)
        return head.decode('ascii'), original, staged

    @_local_errors
    def status(self, workspace, *, cancel=None, connection=None):
        cancel, deadline = cancel if cancel is not None else threading.Event(), time.monotonic() + LOCAL_DEADLINE
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                if connection is not None:
                    if self.connection(root) != connection:
                        raise ValueError('Project binding changed before repository inspection.')
                    self._remote(repo, connection)
                head, original, staged = self._snapshots(repo, cancel, deadline)
                nested = []
                files = self._scan(root, cancel=cancel, deadline=deadline, nested=nested)
                changes = {'add': [], 'delete': [], 'modify': []}
                for name in sorted(original.keys() | staged.keys()):
                    if original.get(name) != staged.get(name):
                        kind = 'add' if name not in original else 'delete' if name not in staged else 'modify'
                        changes[kind].append(name)
                unstaged = []
                total = 0
                for name, (sha, _) in staged.items():
                    check(cancel, deadline)
                    path = root.joinpath(*file_path(name))
                    no_links(path)
                    if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
                        unstaged.append(name)
                        continue
                    data = bounded_read(path, MAX_FILE_BYTES)
                    total += len(data)
                    if total > MAX_CHECKOUT_BYTES:
                        raise ValueError('Status byte scan limit reached.')
                    if Blob.from_string(data).id != sha:
                        unstaged.append(name)
                local_exclude = root / '.git/info/exclude'
                filters = [IgnoreFilter(io.BytesIO(bounded_read(local_exclude, API_BYTES)))] if local_exclude.exists() else []
                for path in files:
                    if path.name == '.gitignore' and path.stat().st_size > API_BYTES:
                        raise ValueError('Ignore file exceeds its size limit.')
                ignore = IgnoreFilterManager(str(root), filters, ignorecase=os.name == 'nt')
                untracked = []
                for path in files:
                    check(cancel, deadline)
                    name = path.relative_to(root).as_posix()
                    file_path(name)
                    if name not in staged and not ignore.is_ignored(name):
                        untracked.append(name)
                truncated = sum(map(len, changes.values())) + len(unstaged) + len(untracked) > 500
                budget = 500
                for values in [*changes.values(), unstaged, untracked]:
                    values.sort()
                    del values[budget:]
                    budget -= len(values)
                return self.vault.redact({'ok': True, 'head': head, 'staged': changes, 'unstaged': unstaged,
                    'untracked': untracked, 'truncated': truncated,
                    'nested_repositories': [path.relative_to(root).as_posix() for path in nested]}, GITHUB_RESULT)
            finally:
                repo.close()

    @_local_errors
    def diff(self, workspace, paths, *, cancel=None, connection=None):
        if not isinstance(paths, list) or not paths or len(paths) > 100:
            raise ValueError('Select 1-100 explicit files to review.')
        for name in paths:
            file_path(name)
        cancel, deadline = cancel if cancel is not None else threading.Event(), time.monotonic() + LOCAL_DEADLINE
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                if connection is not None:
                    if self.connection(root) != connection:
                        raise ValueError('Project binding changed before repository inspection.')
                    self._remote(repo, connection)
                _, original, staged = self._snapshots(repo, cancel, deadline)
                output, used, truncated, total = [], 0, False, 0
                def blob(entry):
                    if entry is None:
                        return b''
                    obj = repo.object_store[entry[0]]
                    if not isinstance(obj, Blob) or obj.raw_length() > MAX_FILE_BYTES:
                        raise ValueError('Diff object exceeds its size limit.')
                    return obj.data
                for name in dict.fromkeys(paths):
                    check(cancel, deadline)
                    display_name = self.vault.redact(name)
                    path = self._repository_path(root, name)
                    if path.is_dir():
                        raise ValueError('Select explicit files, not directories.')
                    try:
                        before, indexed = blob(original.get(name)), blob(staged.get(name))
                        current = bounded_read(path, MAX_FILE_BYTES) if path.exists() else b''
                    except ValueError:
                        lines = [f'File omitted (size limit): {display_name}\n']
                        truncated = True
                    else:
                        total += len(before) + len(indexed) + len(current)
                        if total > 16 * 1024 * 1024:
                            truncated = True
                            break
                        lines = []
                        original_entry, index_entry = original.get(name), staged.get(name)
                        working_entry = (None, index_entry[1] if index_entry else 0o100644) if path.is_file() else None
                        for label, a, b, old_entry, new_entry in [
                                ('staged', before, indexed, original_entry, index_entry),
                                ('working', indexed, current, index_entry, working_entry)]:
                            if a == b:
                                if old_entry is None and new_entry is not None:
                                    lines.append(f'New empty file ({label}): {display_name}\n')
                                elif old_entry is not None and new_entry is None:
                                    lines.append(f'Deleted empty file ({label}): {display_name}\n')
                                elif old_entry is not None and new_entry is not None and old_entry[1] != new_entry[1]:
                                    lines.append(f'Mode changed ({label}): {display_name}\n')
                                continue
                            if b'\0' in a or b'\0' in b:
                                lines.append(f'Binary file differs ({label}): {display_name}\n')
                            elif len(a) + len(b) > 256 * 1024 or a.count(b'\n') + b.count(b'\n') > 2000:
                                lines.append(f'Diff omitted (byte/line work limit, {label}): {display_name}\n')
                                truncated = True
                            else:
                                try:
                                    text_a, text_b = a.decode('utf-8'), b.decode('utf-8')
                                except UnicodeDecodeError:
                                    lines.append(f'Binary/non-UTF-8 file differs ({label}): {display_name}\n')
                                    continue
                                # Protect complete source values before splitting or inserting diff markers.
                                text_a, text_b = self.vault.redact(text_a), self.vault.redact(text_b)
                                if text_a == text_b:
                                    lines.append(f'Protected content differs ({label}): {display_name}\n')
                                    continue
                                if (len(text_a.encode()) + len(text_b.encode()) > 256 * 1024 or
                                        text_a.count('\n') + text_b.count('\n') > 2000):
                                    lines.append(f'Diff omitted (protected text work limit, {label}): {display_name}\n')
                                    truncated = True
                                    continue
                                for line in difflib.unified_diff(text_a.splitlines(True), text_b.splitlines(True),
                                        f'a/{display_name} ({label})', f'b/{display_name} ({label})'):
                                    if line.endswith('\n'):
                                        lines.append(line.removesuffix('\n').removesuffix('\r') + '\n')
                                    else:
                                        lines.extend([line + '\n', '\\ No newline at end of file\n'])
                    for line in lines:
                        check(cancel, deadline)
                        output.append(line)
                        used += len(line.encode('utf-8'))
                        if used >= MAX_DIFF_BYTES:
                            break
                    if used >= MAX_DIFF_BYTES:
                        truncated = True
                        break
                result = self.vault.redact({'ok': True, 'diff': ''.join(output), 'truncated': truncated}, GITHUB_RESULT)
                # The only byte cap applies after complete display records have been redacted.
                if len(result['diff'].encode()) > MAX_DIFF_BYTES:
                    result['diff'] = result['diff'].encode()[:MAX_DIFF_BYTES].decode('utf-8', 'ignore')
                    result['truncated'] = True
                return result
            finally:
                repo.close()
