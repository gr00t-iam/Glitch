"""Durable local conversations, events, anchors and Windows-protected settings."""

import ctypes
import ipaddress
import json
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from ctypes import wintypes
from pathlib import Path
from urllib.parse import urlsplit

DEFAULTS = {
    'mode': 'local', 'ollama_url': 'http://127.0.0.1:11434',
    'worker_model': '', 'supervisor_url': 'https://openrouter.ai/api/v1',
    'supervisor_model': 'anthropic/claude-sonnet-4.6',
    'audit_interval': 5, 'max_steps': 40,
    'discord_user_id': '', 'discord_channel_id': '',
    'context_length': 4096, 'cpu_threads': max(1, min(8, (os.cpu_count() or 2) - 1)),
    'temperature': 0.15, 'vision_projector': '',
    'supervisor_auth': 'api', 'supervisor_provider': 'openrouter',
    'proxy_url': 'http://127.0.0.1:8317/v1', 'proxy_login_url': 'http://127.0.0.1:8317',
    'proxy_model': '',
}


def ollama_endpoint(value: str) -> str:
    """Convert Ollama's server bind setting to a reachable client endpoint."""
    value = value.strip()
    explicit_scheme = '://' in value
    if not explicit_scheme:
        try:
            address = ipaddress.ip_address(value)
            if address.version == 6:
                value = f'[{value}]'
        except ValueError:
            pass
        value = 'http://' + value
    url = urlsplit(value)
    host = url.hostname
    if (url.scheme not in ('http', 'https') or not host or
            any(char.isspace() for char in value) or
            url.username is not None or url.password is not None or url.query or url.fragment):
        raise ValueError('Invalid Ollama endpoint.')
    port = url.port
    if port is not None and port < 1:
        raise ValueError('Invalid Ollama port.')
    host = {'0.0.0.0': '127.0.0.1', '::': '::1'}.get(host, host)
    authority = f'[{host}]' if ':' in host else host
    if port is not None or not explicit_scheme:
        authority += f':{port if port is not None else 11434}'
    return url._replace(netloc=authority).geturl().rstrip('/')


def protect(value: bytes, decrypt: bool = False) -> bytes:
    if os.name != 'nt':
        raise RuntimeError('Credential storage requires Windows data protection.')

    class Blob(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    target = Blob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.data, target.length)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(ctypes.cast(target.data, ctypes.c_void_p))


def redact(text: str) -> str:
    text = re.sub(r'\b(?:sk-[\w-]{12,}|ghp_[\w]+|github_pat_[\w]+)\b', '[credential removed]', text)
    return re.sub(r'(?i)(api[_ -]?key|password|authorization|token)(\s*[:=]\s*)([^\s,;}"\\]+)',
                  r'\1\2[credential removed]', text)


def safe_data(value):
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, list):
        return [safe_data(item) for item in value]
    if isinstance(value, dict):
        return {key: '[credential removed]' if any(word in key.lower() for word in ('password', 'api_key', 'token', 'authorization'))
                else safe_data(item) for key, item in value.items()}
    return value


class Store:
    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'glitch.sqlite3'
        self.lock = threading.RLock()
        self.startup_warnings = []
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, workspace TEXT NOT NULL,
                    title TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, session TEXT NOT NULL,
                    role TEXT NOT NULL, content TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS anchors(id INTEGER PRIMARY KEY, session TEXT NOT NULL,
                    directive TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, session TEXT NOT NULL,
                    kind TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE INDEX IF NOT EXISTS message_session ON messages(session,id);
                CREATE INDEX IF NOT EXISTS event_session ON events(session,id);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def settings(self):
        with self.lock, self.connect() as db:
            result = DEFAULTS | {r['key']: json.loads(r['value']) for r in db.execute('SELECT * FROM settings')}
        result['key_saved'] = (self.directory / 'supervisor.dpapi').exists()
        result['discord_token_saved'] = (self.directory / 'discord.dpapi').exists() or bool(os.environ.get('DISCORD_TOKEN'))
        result['key_saved'] = result['key_saved'] or bool(os.environ.get('CLOUD_SUPERVISOR_API_KEY'))
        result['proxy_token_saved'] = (self.directory / 'proxy.dpapi').exists()
        return result

    def save_settings(self, update):
        current = self.settings()
        values = {k: update.get(k, current[k]) for k in DEFAULTS}
        if values['mode'] not in ('local', 'hybrid'):
            raise ValueError('Choose local or hybrid mode.')
        if values['supervisor_auth'] not in ('api', 'proxy'):
            raise ValueError('Choose developer API or authorized account bridge.')
        if values['supervisor_provider'] not in ('openrouter', 'openai', 'anthropic', 'compatible'):
            raise ValueError('Choose a supported supervisor provider.')
        from glitch.supervisor import loopback_url
        for name in ('proxy_url', 'proxy_login_url'):
            values[name] = loopback_url(values[name])
        values['context_length'] = int(values['context_length'])
        values['cpu_threads'] = int(values['cpu_threads'])
        values['temperature'] = float(values['temperature'])
        if not 1024 <= values['context_length'] <= 32768:
            raise ValueError('Context length must be between 1024 and 32768 tokens.')
        if not 1 <= values['cpu_threads'] <= 128 or not 0 <= values['temperature'] <= 2:
            raise ValueError('Use 1-128 CPU threads and a temperature between 0 and 2.')
        for name in ('ollama_url', 'supervisor_url'):
            if name == 'ollama_url':
                values[name] = ollama_endpoint(values[name])
            url = urlsplit(values[name])
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError('Enter an HTTP or HTTPS endpoint without credentials or query parameters.')
            if url.port is not None and url.port < 1:
                raise ValueError('Invalid endpoint port.')
            if name == 'supervisor_url' and url.scheme != 'https' and url.hostname not in ('localhost', '127.0.0.1', '::1'):
                raise ValueError('Cloud supervisors must use HTTPS.')
            values[name] = values[name].rstrip('/')
        for name in ('audit_interval', 'max_steps'):
            values[name] = int(values[name])
            if not 1 <= values[name] <= 100:
                raise ValueError('Step limits must be between 1 and 100.')
        for name in ('worker_model', 'supervisor_model', 'proxy_model', 'vision_projector'):
            if not isinstance(values[name], str) or len(values[name]) > 200:
                raise ValueError('Invalid model name.')
        for name in ('discord_user_id', 'discord_channel_id'):
            if values[name] and (not isinstance(values[name], str) or not values[name].isdigit() or not 15 <= len(values[name]) <= 22):
                raise ValueError('Discord IDs must be the numeric IDs from Developer Mode.')
        key = update.get('supervisor_key', '')
        if key:
            encrypted = protect(key.strip().encode())
            temporary = self.directory / 'supervisor.tmp'
            temporary.write_bytes(encrypted)
            temporary.replace(self.directory / 'supervisor.dpapi')
        elif update.get('clear_key'):
            (self.directory / 'supervisor.dpapi').unlink(missing_ok=True)
        if update.get('discord_token'):
            temporary = self.directory / 'discord.tmp'
            temporary.write_bytes(protect(update['discord_token'].strip().encode()))
            temporary.replace(self.directory / 'discord.dpapi')
        elif update.get('clear_discord_token'):
            (self.directory / 'discord.dpapi').unlink(missing_ok=True)
        if update.get('proxy_token'):
            temporary = self.directory / 'proxy.tmp'
            temporary.write_bytes(protect(update['proxy_token'].strip().encode()))
            temporary.replace(self.directory / 'proxy.dpapi')
        elif update.get('clear_proxy_token'):
            (self.directory / 'proxy.dpapi').unlink(missing_ok=True)
        with self.lock, self.connect() as db:
            db.executemany('INSERT OR REPLACE INTO settings VALUES (?,?)',
                           [(k, json.dumps(v)) for k, v in values.items()])
        return self.settings()

    def supervisor_key(self):
        path = self.directory / 'supervisor.dpapi'
        return os.environ.get('CLOUD_SUPERVISOR_API_KEY') or (protect(path.read_bytes(), decrypt=True).decode() if path.exists() else '')

    def discord_token(self):
        path = self.directory / 'discord.dpapi'
        return os.environ.get('DISCORD_TOKEN') or (protect(path.read_bytes(), decrypt=True).decode() if path.exists() else '')

    def proxy_token(self):
        path = self.directory / 'proxy.dpapi'
        return protect(path.read_bytes(), decrypt=True).decode() if path.exists() else ''

    def import_environment(self):
        self.startup_warnings = []
        for variable, name in [('OLLAMA_HOST', 'ollama_url'), ('DISCORD_USER_ID', 'discord_user_id'),
                               ('DISCORD_CHANNEL_ID', 'discord_channel_id')]:
            if os.environ.get(variable):
                try:
                    self.save_settings({name: os.environ[variable]})
                except (ValueError, TypeError):
                    # Do not expose invalid values: an endpoint may contain credentials.
                    self.startup_warnings.append(
                        f'Ignored invalid {variable}. Your saved settings are unchanged; open Settings to configure it.')
        return list(self.startup_warnings)

    def new_session(self, workspace):
        root = Path(workspace).resolve(strict=True)
        if not root.is_dir():
            raise ValueError('Choose a project folder.')
        session = str(uuid.uuid4())
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO sessions(id,workspace,title) VALUES (?,?,?)', (session, str(root), 'New conversation'))
        return session

    def sessions(self):
        with self.lock, self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM sessions ORDER BY created_at DESC,rowid DESC')]

    def session(self, session):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT * FROM sessions WHERE id=?', (session,)).fetchone()
        if row is None:
            raise ValueError('Conversation does not exist.')
        return dict(row)

    def message(self, session, role, content):
        content = redact(content)
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO messages(session,role,content) VALUES (?,?,?)', (session, role, content))
            if role == 'user':
                db.execute("UPDATE sessions SET title=? WHERE id=? AND title='New conversation'", (content[:60], session))

    def messages(self, session):
        with self.lock, self.connect() as db:
            return [dict(r) for r in db.execute('SELECT role,content FROM messages WHERE session=? ORDER BY id', (session,))]

    def anchor(self, session, directive):
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO anchors(session,directive) VALUES (?,?)', (session, redact(directive)))

    def anchors(self, session):
        with self.lock, self.connect() as db:
            return [r[0] for r in db.execute('SELECT directive FROM anchors WHERE session=? ORDER BY id', (session,))]

    def event(self, session, kind, title, payload=None):
        with self.lock, self.connect() as db:
            cursor = db.execute('INSERT INTO events(session,kind,title,payload) VALUES (?,?,?,?)',
                                (session, kind, redact(title), json.dumps(safe_data(payload or {}), ensure_ascii=True)))
            return cursor.lastrowid

    def events(self, session, after):
        with self.lock, self.connect() as db:
            return [dict(r) | {'payload': json.loads(r['payload'])} for r in db.execute(
                'SELECT * FROM events WHERE session=? AND id>? ORDER BY id LIMIT 300', (session, int(after)))]
