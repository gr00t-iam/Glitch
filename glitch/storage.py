"""Durable local conversations, events, anchors and Windows-protected settings."""

import ctypes
import hashlib
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
from glitch.redaction import MESSAGE, SESSION, PROJECT, event, event_payload, tool_name, CONTENT, stored_message

DEFAULTS = {
    'mode': 'local', 'ollama_url': 'http://127.0.0.1:11434',
    'worker_model': '', 'supervisor_url': 'https://openrouter.ai/api/v1',
    'supervisor_model': 'anthropic/claude-sonnet-4.6',
    'audit_interval': 5, 'max_steps': 40,
    'discord_user_id': '', 'discord_channel_id': '',
    'context_length': 4096, 'cpu_threads': max(1, min(8, (os.cpu_count() or 2) - 1)),
    'temperature': 0.15, 'vision_projector': '', 'gpu_mode': 'auto',
    'supervisor_auth': 'api', 'supervisor_provider': 'openrouter',
    'proxy_url': 'http://127.0.0.1:8317/v1', 'proxy_login_url': 'http://127.0.0.1:8317',
    'proxy_model': '', 'full_access': False, 'parallel_streams': 1,
    'wake_word_enabled': False, 'announce_completed_tasks': False,
    'speech_voice_id': '', 'speech_volume': 80, 'speech_rate': 0,
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
        self._vault = None
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
                CREATE TABLE IF NOT EXISTS vault(id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    kind TEXT NOT NULL, origin TEXT NOT NULL, ciphertext BLOB NOT NULL,
                    custom_ca INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
                    updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')));
            ''')
            db.execute('''UPDATE settings SET value='""' WHERE key='vision_projector'
                AND value!='""' AND value=(SELECT value FROM settings WHERE key='worker_model')''')
            self._migrate_history(db)
            message_columns = {row['name'] for row in db.execute('PRAGMA table_info(messages)')}
            for name in ('images', 'model_content'):
                if name not in message_columns:
                    db.execute(f'ALTER TABLE messages ADD COLUMN {name} TEXT')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS context_checkpoints(
                    id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL,
                    checkpoint TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE INDEX IF NOT EXISTS checkpoint_session ON context_checkpoints(session,id);
            ''')

    def _migrate_history(self, db):
        db.execute('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, workspace TEXT NOT NULL UNIQUE)')
        columns = {row['name'] for row in db.execute('PRAGMA table_info(sessions)')}
        for name, declaration in (('project_id', 'TEXT'), ('chat_watermark', 'INTEGER NOT NULL DEFAULT 0'),
                                  ('timeline_watermark', 'INTEGER NOT NULL DEFAULT 0'),
                                  ('chat_event_watermark', 'INTEGER NOT NULL DEFAULT 0')):
            if name not in columns:
                db.execute(f'ALTER TABLE sessions ADD COLUMN {name} {declaration}')
        for row in db.execute('SELECT id,workspace FROM sessions WHERE project_id IS NULL').fetchall():
            project = self._register_project(db, row['workspace'])
            db.execute('UPDATE sessions SET project_id=? WHERE id=?', (project, row['id']))
        # SQLite's default rowid allocator reuses the highest deleted ID. Preserve
        # archive references and event cursors across deletion and restart instead.
        for table in ('messages', 'events'):
            sql = db.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()[0]
            if 'AUTOINCREMENT' not in sql.upper():
                db.execute(f'ALTER TABLE {table} RENAME TO {table}_legacy')
                db.execute(sql.replace('INTEGER PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT'))
                db.execute(f'INSERT INTO {table} SELECT * FROM {table}_legacy')
                db.execute(f'DROP TABLE {table}_legacy')
            db.execute(f'CREATE INDEX IF NOT EXISTS {table}_session_id ON {table}(session,id)')

    def _register_project(self, db, workspace):
        canonical = os.path.normcase(str(Path(workspace).resolve()))
        row = db.execute('SELECT id FROM projects WHERE workspace=?', (canonical,)).fetchone()
        if row:
            return row['id']
        identifier = str(uuid.uuid4())
        db.execute('INSERT INTO projects VALUES(?,?)', (identifier, canonical))
        return identifier

    def projects(self):
        with self.lock, self.connect() as db:
            rows = [dict(row) for row in db.execute('SELECT * FROM projects ORDER BY rowid DESC')]
        return self.redact(rows, [PROJECT])

    def _delete_sessions(self, db, sessions):
        for session in sessions:
            for table in ('messages', 'anchors', 'events', 'agent_runs', 'checkpoints', 'context_checkpoints'):
                if db.execute('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?', (table,)).fetchone():
                    db.execute(f'DELETE FROM {table} WHERE session=?', (session,))
            db.execute('DELETE FROM sessions WHERE id=?', (session,))

    def delete_session(self, session):
        with self.lock, self.connect() as db:
            if not db.execute('SELECT 1 FROM sessions WHERE id=?', (session,)).fetchone():
                raise ValueError('Conversation does not exist.')
            self._delete_sessions(db, [session])

    def remove_project(self, project):
        with self.lock, self.connect() as db:
            if not db.execute('SELECT 1 FROM projects WHERE id=?', (project,)).fetchone():
                raise ValueError('Project does not exist.')
            sessions = [row['id'] for row in db.execute('SELECT id FROM sessions WHERE project_id=?', (project,))]
            self._delete_sessions(db, sessions)
            db.execute('DELETE FROM projects WHERE id=?', (project,))

    def clear_view(self, session, kind):
        if kind not in ('chat', 'timeline'):
            raise ValueError('Choose chat or timeline.')
        with self.lock, self.connect() as db:
            if not db.execute('SELECT 1 FROM sessions WHERE id=?', (session,)).fetchone():
                raise ValueError('Conversation does not exist.')
            table = 'messages' if kind == 'chat' else 'events'
            watermark = db.execute(f'SELECT COALESCE(MAX(id),0) FROM {table} WHERE session=?', (session,)).fetchone()[0]
            db.execute(f'UPDATE sessions SET {kind}_watermark=? WHERE id=?', (watermark, session))
            if kind == 'chat':
                event_id = db.execute('SELECT COALESCE(MAX(id),0) FROM events WHERE session=?', (session,)).fetchone()[0]
                db.execute('UPDATE sessions SET chat_event_watermark=? WHERE id=?', (event_id, session))
        return {'session': session, 'kind': kind, 'watermark': watermark}

    def visible_messages(self, session):
        watermark = self.session(session)['chat_watermark']
        return [m for m in self.messages(session) if m['id'] > watermark and m['role'] != 'context'
                and (m['role'] != 'assistant' or m['content'])]

    def visible_events(self, session, after):
        record = self.session(session)
        events = self.events(session, max(int(after), record['timeline_watermark']))
        for item in events:
            if item['kind'] == 'message':
                message_id = item['payload'].get('message_id')
                item['chat_visible'] = (message_id > record['chat_watermark'] if message_id is not None
                                        else item['id'] > record['chat_event_watermark'])
        return events

    @property
    def vault(self):
        with self.lock:
            if self._vault is None:
                from glitch.vault import Vault
                self._vault = Vault(self)
            return self._vault

    def redact(self, value, schema=None):
        return self.vault.redact(value, schema)

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
        if values['gpu_mode'] not in ('auto', 'cuda', 'cpu'):
            raise ValueError('Choose Automatic, NVIDIA GPU or CPU processing.')
        if values['vision_projector'] and values['vision_projector'] == values['worker_model']:
            raise ValueError('A language model cannot be its own vision projector. Choose Text / browser DOM only.')
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
        if not 1024 <= values['context_length'] <= 131072:
            raise ValueError('Context length must be between 1024 and 131072 tokens.')
        if type(values['full_access']) is not bool:
            raise ValueError('Full Access must be explicitly on or off.')
        for key in ('wake_word_enabled', 'announce_completed_tasks'):
            if type(values[key]) is not bool:
                raise ValueError('Voice settings must be explicitly on or off.')
        for key, low, high in (('parallel_streams', 1, 4), ('speech_volume', 0, 100), ('speech_rate', -10, 10)):
            if type(values[key]) is not int or not low <= values[key] <= high:
                raise ValueError(f'{key} must be between {low} and {high}.')
        if not isinstance(values['speech_voice_id'], str) or len(values['speech_voice_id']) > 500:
            raise ValueError('Invalid speech voice.')
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
            project = self._register_project(db, root)
            db.execute('INSERT INTO sessions(id,workspace,title,project_id) VALUES (?,?,?,?)',
                       (session, str(root), 'New conversation', project))
        return session

    def sessions(self):
        with self.lock, self.connect() as db:
            return self.redact([dict(r) for r in db.execute('SELECT * FROM sessions ORDER BY created_at DESC,rowid DESC')], [SESSION])

    def session(self, session):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT * FROM sessions WHERE id=?', (session,)).fetchone()
        if row is None:
            raise ValueError('Conversation does not exist.')
        return dict(row)

    def message(self, session, role, content, images=None, model_content=None):
        content = self.redact(content, CONTENT if role == 'context' else None)
        model_content = self.redact(model_content, CONTENT) if model_content is not None else None
        with self.lock, self.connect() as db:
            cursor = db.execute('INSERT INTO messages(session,role,content,images,model_content) VALUES (?,?,?,?,?)',
                                (session, role, content, json.dumps(images) if images else None, model_content))
            if role == 'user':
                db.execute("UPDATE sessions SET title=? WHERE id=? AND title='New conversation'", (content[:60], session))
            return cursor.lastrowid

    def messages(self, session):
        with self.lock, self.connect() as db:
            return self.redact([stored_message(dict(r)) for r in db.execute('SELECT id,role,content FROM messages WHERE session=? ORDER BY id', (session,))], [MESSAGE])

    @staticmethod
    def _message_digest(row):
        return hashlib.sha256(json.dumps([row['id'], row['role'], row['content'], row['images'], row['model_content']],
                                         ensure_ascii=True).encode()).hexdigest()

    def _working_row(self, row):
        result = dict(row)
        result['_fingerprint'] = self._message_digest(row)
        result['content'] = row['model_content'] if row['model_content'] is not None else row['content']
        result.pop('model_content', None)
        result.pop('session', None)
        if row['images']:
            result['images'] = json.loads(row['images'])
        else:
            result.pop('images', None)
        if row['model_content'] is not None:
            # Only host-authored assistant decision envelopes use this column.
            from glitch.redaction import DECISION, ProtocolText
            result['content'] = ProtocolText((json.loads(result['content']), DECISION))
        return self.redact(stored_message(result), MESSAGE)

    def history_page(self, session, after=0, limit=32, end=None):
        if type(limit) is not int or not 1 <= limit <= 128:
            raise ValueError('History page limit must be 1-128.')
        with self.lock, self.connect() as db:
            return [self._working_row(row) for row in db.execute(
                'SELECT * FROM messages WHERE session=? AND id>? AND (? IS NULL OR id<=?) ORDER BY id LIMIT ?',
                (session, after, end, end, limit))]

    def source_message(self, session, identifier):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT * FROM messages WHERE session=? AND id=?', (session, identifier)).fetchone()
            if row is None:
                raise ValueError('Checkpoint source is missing from this conversation.')
            return self._working_row(row)

    def context_checkpoint(self, session):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT checkpoint FROM context_checkpoints WHERE session=? ORDER BY id DESC LIMIT 1',
                             (session,)).fetchone()
        return json.loads(row['checkpoint']) if row else None

    def save_context_checkpoint(self, session, checkpoint, cancel):
        from glitch.redaction import CHECKPOINT
        checkpoint = self.redact(checkpoint, CHECKPOINT)
        with self.lock, self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM sessions WHERE id=?', (session,)).fetchone():
                raise ValueError('Conversation was removed before checkpoint commit.')
            ids = checkpoint['source_ids']
            actual = [row['id'] for row in db.execute('SELECT id FROM messages WHERE session=? AND id<=? ORDER BY id',
                                                    (session, ids[-1]))]
            if ids != actual:
                raise ValueError('Checkpoint source coverage changed; no checkpoint saved.')
            for identifier, digest in zip(ids, checkpoint['source_hashes']):
                if cancel.is_set():
                    raise InterruptedError('Stopped before checkpoint commit.')
                row = db.execute('SELECT * FROM messages WHERE session=? AND id=?', (session, identifier)).fetchone()
                if self._message_digest(row) != digest:
                    raise ValueError('Checkpoint source changed; no checkpoint saved.')
            if len(ids) != len(checkpoint['source_hashes']):
                raise ValueError('Incomplete checkpoint source hashes.')
            if cancel.is_set():
                raise InterruptedError('Stopped before checkpoint commit.')
            db.execute('INSERT INTO context_checkpoints(session,checkpoint) VALUES(?,?)',
                       (session, json.dumps(checkpoint, ensure_ascii=True)))

    def retrieve_history(self, session, start_id, end_id, limit, offset=0, anchors=False, working=False):
        if (any(type(value) is not int for value in (start_id, end_id, limit, offset)) or
                start_id < 1 or end_id < start_id or not 1 <= limit <= 20 or offset < 0 or
                type(anchors) is not bool or type(working) is not bool):
            raise ValueError('Use ordered positive archive IDs, a 1-20 limit and a nonnegative character offset.')
        table, column = ('anchors', 'directive') if anchors else ('messages', 'content')
        with self.lock, self.connect() as db:
            rows = db.execute(f'SELECT id,{column}' + (',role,model_content' if not anchors else '') +
                              f' FROM {table} WHERE session=? AND id BETWEEN ? AND ? ORDER BY id LIMIT ?',
                              (session, start_id, end_id, limit + 1)).fetchall()
        remaining, result, continuation = 16000, [], None
        for row in rows[:limit]:
            if working and not anchors and row['model_content'] is not None:
                from glitch.redaction import DECISION, ProtocolText
                text = self.redact(ProtocolText((json.loads(row['model_content']), DECISION)), CONTENT)
            elif not anchors and row['role'] == 'context':
                text = self.redact(stored_message({'role': 'context', 'content': row[column]})['content'], CONTENT)
            else:
                text = self.redact(row[column])
            start = offset if row['id'] == start_id else 0
            from glitch.redaction import ProtocolText
            content = (ProtocolText(*text.parts, offset=start, limit=remaining) if isinstance(text, ProtocolText)
                       else text[start:start + remaining])
            result.append({'id': row['id'], 'role': 'context' if anchors else row['role'], 'content': content,
                           'offset': start})
            remaining -= len(content)
            if start + len(content) < len(text):
                continuation = {'start_id': row['id'], 'offset': start + len(content)}
                break
            if not remaining:
                next_rows = [item for item in rows if item['id'] > row['id']]
                if next_rows:
                    continuation = {'start_id': next_rows[0]['id'], 'offset': 0}
                break
        if continuation is None and len(rows) > limit:
            continuation = {'start_id': rows[limit]['id'], 'offset': 0}
        return {'ok': True, 'session': session, 'messages': result, 'truncated': continuation is not None,
                'next': continuation, 'anchors': anchors, 'working': working}

    def active_anchors(self, session, limit=4):
        with self.lock, self.connect() as db:
            rows = db.execute('SELECT id,directive FROM anchors WHERE session=? ORDER BY id DESC LIMIT ?',
                              (session, limit)).fetchall()
            boundary = rows[-1]['id'] if rows else 0
            archive = db.execute('SELECT MIN(id),MAX(id),COUNT(*) FROM anchors WHERE session=? AND id<?',
                                 (session, boundary)).fetchone()
        return {'active': [{'id': row['id'], 'directive': self.redact(row['directive'])} for row in reversed(rows)],
                'archived_anchor_range': {'start_id': archive[0], 'end_id': archive[1], 'count': archive[2]} if archive[2] else None}

    def anchor(self, session, directive):
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO anchors(session,directive) VALUES (?,?)', (session, self.redact(directive)))

    def anchors(self, session):
        with self.lock, self.connect() as db:
            return self.redact([r[0] for r in db.execute('SELECT directive FROM anchors WHERE session=? ORDER BY id', (session,))])

    def event(self, session, kind, title, payload=None):
        with self.lock, self.connect() as db:
            if kind == 'message':
                row = db.execute("SELECT id FROM messages WHERE session=? AND role='assistant' ORDER BY id DESC LIMIT 1", (session,)).fetchone()
                if row:
                    payload = dict(payload or {}) | {'message_id': row['id']}
            cursor = db.execute('INSERT INTO events(session,kind,title,payload) VALUES (?,?,?,?)',
                                (session, self.redact(kind, event({'kind': kind})['kind']),
                                 self.redact(title, tool_name if kind in ('tool', 'result', 'error') else None),
                                 json.dumps(safe_data(self.redact(payload or {}, event_payload(kind, title))), ensure_ascii=True)))
            return cursor.lastrowid

    def events(self, session, after):
        with self.lock, self.connect() as db:
            return self.redact([dict(r) | {'payload': json.loads(r['payload'])} for r in db.execute(
                'SELECT * FROM events WHERE session=? AND id>? ORDER BY id LIMIT 300', (session, int(after)))], [event])
