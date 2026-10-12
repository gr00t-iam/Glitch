"""Read-only GitHub connections and native local checkouts. No publishing tools."""
import base64
import difflib
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
import time
from pathlib import Path

from dulwich.client import AbstractHttpGitClient
from dulwich.config import ConfigFile, StackedConfig
from dulwich.ignore import IgnoreFilter, IgnoreFilterManager
from dulwich.index import Index, index_entry_from_stat
from dulwich.object_store import iter_tree_contents
from dulwich.objects import Blob, Commit
from dulwich.refs import check_ref_format
from dulwich.repo import Repo
from glitch.redaction import GITHUB_RESULT, GITHUB_REPOSITORY
from glitch.resources import SHARED_RESOURCES

API_BYTES = 1024 * 1024
MAX_PAGES = 10
MAX_FILES = 10000
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_CHECKOUT_BYTES = 256 * 1024 * 1024
MAX_PACK_BYTES = 512 * 1024 * 1024
MAX_DIFF_BYTES = 65536
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
    def __call__(self, endpoint, payload, cancel, deadline):
        # Routes are host-constructed. Never follow pagination Link URLs.
        if not re.fullmatch(r'/user|/repos/[A-Za-z0-9-]+/[A-Za-z0-9_.-]+|/user/repos\?per_page=100&page=[1-9][0-9]*', endpoint):
            raise ValueError('Unsupported GitHub API route.')
        headers = {'Authorization': 'Bearer ' + payload['token'], 'Accept': 'application/vnd.github+json',
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Glitch'}
        response = _Response('api.github.com', endpoint, payload, cancel, deadline, headers)
        try:
            if response.status != 200:
                return response.status, response.headers, None
            chunks = []
            while chunk := response.read(65536):
                chunks.append(chunk)
            return response.status, response.headers, json.loads(b''.join(chunks))
        finally:
            response.close()


class NativeGitClient(AbstractHttpGitClient):
    """Dulwich smart fetch using a non-redirecting, non-proxy native HTTPS transport."""
    def __init__(self, url, payload, cancel, deadline):
        safe_remote(url)
        super().__init__(url, dumb=False, thin_packs=True, quiet=True)
        self.url, self.payload, self.cancel, self.deadline = url, payload, cancel, deadline
        self.received = 0

    def _http_request(self, url, headers=None, data=None, raise_for_status=True):
        # No dumb HTTP, bundles, packfile-URIs, receive-pack, redirects or auth callbacks.
        if url == self.url + '/info/refs?service=git-upload-pack' and data is None:
            route = url[len('https://github.com'):]
        elif url == self.url + '/git-upload-pack' and isinstance(data, bytes) and len(data) <= API_BYTES:
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


def _local_errors(method):
    @wraps(method)
    def guarded(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (InterruptedError, TimeoutError):
            raise
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
        timer = threading.Timer(max(0, deadline - time.monotonic()), cancel.set)
        timer.daemon = True
        timer.start()
        try:
            with self.resources.lease('Write file', str(workspace), cancel):
                yield
        except InterruptedError:
            if time.monotonic() >= deadline:
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

    def _get(self, endpoint, payload, cancel, deadline):
        check(cancel, deadline)
        try:
            code, headers, data = self.http(endpoint, payload, cancel, deadline)
            check(cancel, deadline)
            if code == 401:
                raise ValueError('GitHub token is invalid or expired; replace the saved token.')
            if code in (403, 429):
                limited = code == 429 or any(k.lower() == 'x-ratelimit-remaining' and str(v) == '0'
                                           for k, v in headers.items()) or any(k.lower() == 'retry-after' for k in headers)
                raise ValueError('GitHub rate limit reached; retry later.' if limited else
                                 'GitHub access denied. Check token permissions and organization approval.')
            if code == 404:
                raise ValueError('GitHub repository or account unavailable; check access and spelling.')
            if 300 <= code < 400:
                raise ValueError('GitHub redirect refused. Select the canonical repository.')
            if code != 200:
                raise ValueError('GitHub service returned an unsuccessful response.')
            if len(json.dumps(data, allow_nan=False).encode()) > API_BYTES:
                raise ValueError('GitHub response exceeded its size limit.')
            return data
        except InterruptedError:
            raise
        except ssl.SSLError:
            raise ValueError('GitHub TLS verification failed. Check the trusted CA.') from None
        except (TimeoutError, socket.timeout):
            check(cancel, deadline)
            raise ValueError('GitHub request timed out.') from None
        except ValueError as error:
            # Only host-authored messages are exposed; JSON parser errors may echo responses.
            if str(error).startswith('GitHub'):
                raise ValueError(str(error)) from None
            raise ValueError('GitHub returned invalid response data.') from None
        except Exception:
            check(cancel, deadline)
            raise ValueError('GitHub connection failed. Check network and certificate trust.') from None

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

    def clone(self, credential_id, owner, repo, parent, folder, cancel):
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
        with self._bounded_lease(destination, cancel, deadline):
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
    def _scan(root, *, cancel, deadline, metadata=False):
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
                if path.is_file():
                    files.append(path)
        return files

    def _open(self, workspace, cancel, deadline):
        root = no_links(workspace)
        git = root / '.git'
        if not git.is_dir():
            raise ValueError('Choose a local checkout with an in-workspace .git directory.')
        self._scan(git, cancel=cancel, deadline=deadline, metadata=True)
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
    def status(self, workspace):
        cancel, deadline = threading.Event(), time.monotonic() + LOCAL_DEADLINE
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
                head, original, staged = self._snapshots(repo, cancel, deadline)
                files = self._scan(root, cancel=cancel, deadline=deadline)
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
                                          'untracked': untracked, 'truncated': truncated}, GITHUB_RESULT)
            finally:
                repo.close()

    @_local_errors
    def diff(self, workspace, paths):
        if not isinstance(paths, list) or not paths or len(paths) > 100:
            raise ValueError('Select 1-100 explicit files to review.')
        for name in paths:
            file_path(name)
        cancel, deadline = threading.Event(), time.monotonic() + LOCAL_DEADLINE
        with self._bounded_lease(workspace, cancel, deadline):
            root, repo = self._open(workspace, cancel, deadline)
            try:
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
                    path = no_links(root.joinpath(*file_path(name)))
                    if path.is_dir():
                        raise ValueError('Select explicit files, not directories.')
                    try:
                        before, indexed = blob(original.get(name)), blob(staged.get(name))
                        current = bounded_read(path, MAX_FILE_BYTES) if path.exists() else b''
                    except ValueError:
                        lines = [f'File omitted (size limit): {name}\n']
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
                                    lines.append(f'New empty file ({label}): {name}\n')
                                elif old_entry is not None and new_entry is None:
                                    lines.append(f'Deleted empty file ({label}): {name}\n')
                                elif old_entry is not None and new_entry is not None and old_entry[1] != new_entry[1]:
                                    lines.append(f'Mode changed ({label}): {name}\n')
                                continue
                            if b'\0' in a or b'\0' in b:
                                lines.append(f'Binary file differs ({label}): {name}\n')
                            elif len(a) + len(b) > 256 * 1024 or a.count(b'\n') + b.count(b'\n') > 2000:
                                lines.append(f'Diff omitted (byte/line work limit, {label}): {name}\n')
                                truncated = True
                            else:
                                lines.extend(difflib.unified_diff(a.decode('utf-8', 'replace').splitlines(True),
                                    b.decode('utf-8', 'replace').splitlines(True), f'a/{name} ({label})', f'b/{name} ({label})'))
                    for line in lines:
                        check(cancel, deadline)
                        encoded = line.encode('utf-8')
                        remaining = MAX_DIFF_BYTES - used
                        if len(encoded) > remaining:
                            output.append(encoded[:remaining].decode('utf-8', 'ignore'))
                            truncated = True
                            used = MAX_DIFF_BYTES
                            break
                        output.append(line)
                        used += len(encoded)
                    if used >= MAX_DIFF_BYTES:
                        truncated = True
                        break
                result = self.vault.redact({'ok': True, 'diff': ''.join(output), 'truncated': truncated}, GITHUB_RESULT)
                if len(result['diff'].encode()) > MAX_DIFF_BYTES:
                    result['diff'] = result['diff'].encode()[:MAX_DIFF_BYTES].decode('utf-8', 'ignore')
                    result['truncated'] = True
                return result
            finally:
                repo.close()
