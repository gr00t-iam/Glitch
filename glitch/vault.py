"""Account-protected credentials. Resolution is for host transports, never tools/UI."""
import ipaddress
import json
import os
import re
import ssl
import uuid
from urllib.parse import urlsplit

from glitch.storage import protect, redact as pattern_redact
from glitch.redaction import boundary, DESCRIPTOR

REMOVED = '[credential removed]'
FIELDS = {
    'bearer': ('token',), 'github': ('token',),
    'basic': ('username', 'password'), 'browser': ('username', 'password'),
    'proxmox': ('token_id', 'secret'),
}


class CredentialTextStream:
    """Hold a bounded suffix until exact credentials crossing a chunk are complete."""
    def __init__(self, secrets):
        self.secrets = secrets
        self.carry = max(map(len, secrets), default=1) - 1
        if self.carry > 131072:
            raise RuntimeError('Credential redaction limit exceeded; output is blocked.')
        self.pattern = re.compile('|'.join(re.escape(s) for s in secrets)) if secrets else None
        self.pending = ''

    def feed(self, text):
        self.pending += text
        end = max(0, len(self.pending) - self.carry)
        if self.pattern:
            for match in self.pattern.finditer(self.pending):
                if match.start() >= end:
                    break
                end = max(end, match.end())
            safe = self.pattern.sub(REMOVED, self.pending[:end])
        else:
            safe = self.pending[:end]
        self.pending = self.pending[end:]
        return pattern_redact(safe)

    def finish(self, incomplete=False):
        text, self.pending = self.pending, ''
        if incomplete:
            # Overflow is not EOF. Omit the bounded uncertain suffix entirely.
            return REMOVED if text else ''
        return pattern_redact(self.pattern.sub(REMOVED, text) if self.pattern else text)


def canonical_origin(value):
    """Accept only an HTTPS authority; never URLs containing routes or credentials."""
    try:
        if (not isinstance(value, str) or len(value) > 2048 or
                any(c.isspace() or ord(c) < 32 for c in value) or
                any(c in value for c in '\\?#%')):
            raise ValueError()
        url = urlsplit(value)
        host, port = url.hostname, url.port
        if (url.scheme != 'https' or not host or url.username is not None or
                url.password is not None or url.path not in ('', '/') or
                url.netloc.endswith(':') or port == 0):
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
            host = f'[{address.compressed}]' if address.version == 6 else str(address)
        except ValueError:
            host = host.encode('idna').decode('ascii').lower()
            if len(host) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                                          for label in host.split('.')):
                raise ValueError()
        return 'https://' + host + (f':{port}' if port is not None and port != 443 else '')
    except (ValueError, TypeError, UnicodeError):
        raise ValueError('Enter an HTTPS origin without credentials, path, query or fragment and with a valid port.') from None


class Vault:
    def __init__(self, store, *, cipher=None):
        self.store = store
        self._cipher = cipher or protect
        self._loaded = {}
        # Retain exact values for output redaction after replacement/deletion in this process.
        self._secrets = set()

    @staticmethod
    def _identifier(identifier):
        if not isinstance(identifier, str) or not identifier or len(identifier) > 100:
            raise ValueError('Invalid credential ID.')
        return identifier

    @staticmethod
    def _validate(name, kind, origin, payload):
        if (not isinstance(name, str) or not name.strip() or len(name) > 120 or
                any(ord(c) < 32 for c in name)):
            raise ValueError('Enter a credential name of 1-120 characters.')
        if not isinstance(kind, str) or kind not in FIELDS:
            raise ValueError('Choose a supported credential type.')
        origin = canonical_origin(origin)
        if kind == 'github' and origin != 'https://github.com':
            raise ValueError('GitHub credentials must be scoped to https://github.com.')
        required = set(FIELDS[kind])
        if (not isinstance(payload, dict) or not required.issubset(payload) or
                set(payload) - required - {'ca_pem'}):
            raise ValueError('Provide only the fields required by this credential type and optional CA PEM.')
        for key, value in payload.items():
            limit = 65536 if key == 'ca_pem' else 16384
            if (not isinstance(value, str) or not value or len(value) > limit or
                    (key != 'ca_pem' and any(ord(c) < 32 or ord(c) == 127 for c in value))):
                raise ValueError('Credential fields must be nonempty bounded text without control characters.')
        if kind == 'proxmox' and not re.fullmatch(r'[^\s!=@]+@[^\s!=@]+![^\s!=@]+', payload['token_id']):
            raise ValueError('Use a Proxmox token identifier in user@realm!token format.')
        if payload.get('ca_pem'):
            try:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                context.load_verify_locations(cadata=payload['ca_pem'])
            except (ssl.SSLError, ValueError):
                raise ValueError('Enter a valid PEM CA certificate; TLS verification cannot be disabled.') from None
        encoded = json.dumps(payload, ensure_ascii=True, allow_nan=False).encode('utf-8')
        if len(encoded) > 131072:
            raise ValueError('Credential payload is too large.')
        return name.strip(), origin, encoded

    @staticmethod
    def _metadata(row):
        return {key: row[key] for key in ('id', 'name', 'kind', 'origin', 'created_at', 'updated_at')} | {
            'saved': True, 'tls': {'verify': True, 'custom_ca': bool(row['custom_ca'])}}

    def list(self):
        with self.store.lock, self.store.connect() as db:
            items = [self._metadata(row) for row in db.execute(
                'SELECT id,name,kind,origin,custom_ca,created_at,updated_at FROM vault ORDER BY created_at,id')]
            try:
                return self.redact(items, [DESCRIPTOR])
            except RuntimeError:
                # Keep opaque IDs available to delete/replace unreadable ciphertext.
                return [item | {'name': 'Credential requires recovery', 'origin': '[unavailable]'} for item in items]

    def _remember(self, payload):
        self._secrets.update(value for key, value in payload.items() if key != 'ca_pem')

    def save(self, name, kind, origin, payload, identifier=None):
        name, origin, encoded = self._validate(name, kind, origin, payload)
        if identifier is not None:
            self._identifier(identifier)
        with self.store.lock, self.store.connect() as db:
            if identifier is not None and not db.execute('SELECT 1 FROM vault WHERE id=?', (identifier,)).fetchone():
                raise ValueError('Credential does not exist.')
            self._refresh(db, replacing=identifier)
            # Display metadata must not become an alternate way to return a secret.
            new_secrets = {v for k, v in payload.items() if k != 'ca_pem'}
            if any(secret in name or secret in origin for secret in self._secrets | new_secrets):
                raise ValueError('Credential metadata must not contain credential values.')
            for row in db.execute('SELECT id,name,origin FROM vault'):
                if row['id'] != identifier and any(secret in row['name'] or secret in row['origin'] for secret in new_secrets):
                    raise ValueError('Credential values must not overlap existing credential metadata.')
            try:
                ciphertext = self._cipher(encoded)
                if not isinstance(ciphertext, bytes) or not ciphertext or ciphertext == encoded:
                    raise ValueError()
            except Exception:
                raise RuntimeError('Unable to protect credential with Windows account encryption.') from None
            if identifier is None:
                identifier = str(uuid.uuid4())
                db.execute('INSERT INTO vault(id,name,kind,origin,ciphertext,custom_ca) VALUES(?,?,?,?,?,?)',
                           (identifier, name, kind, origin, ciphertext, bool(payload.get('ca_pem'))))
            else:
                db.execute("UPDATE vault SET name=?,kind=?,origin=?,ciphertext=?,custom_ca=?,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?",
                           (name, kind, origin, ciphertext, bool(payload.get('ca_pem')), identifier))
            self._remember(payload)
            self._loaded[identifier] = ciphertext
            return self._metadata(db.execute('SELECT * FROM vault WHERE id=?', (identifier,)).fetchone())

    def delete(self, identifier):
        self._identifier(identifier)
        with self.store.lock, self.store.connect() as db:
            row = db.execute('SELECT * FROM vault WHERE id=?', (identifier,)).fetchone()
            if row is None:
                raise ValueError('Credential does not exist.')
            # Allow deleting an unreadable record as the recovery path; never emit its contents.
            try:
                self._remember(self._decode(row))
            except RuntimeError:
                pass
            db.execute('DELETE FROM vault WHERE id=?', (identifier,))
            self._loaded.pop(identifier, None)

    def _decode(self, row):
        try:
            payload = json.loads(self._cipher(bytes(row['ciphertext']), decrypt=True).decode('utf-8'))
            self._validate(row['name'], row['kind'], row['origin'], payload)
            return payload
        except Exception:
            raise RuntimeError('Unable to unlock credential. Use the original Windows account or replace/delete the saved entry.') from None

    def resolve(self, identifier, origin):
        """Host-only broker: a caller must supply the exact registered origin, not a redirect URL."""
        self._identifier(identifier)
        origin = canonical_origin(origin)
        with self.store.lock, self.store.connect() as db:
            row = db.execute('SELECT * FROM vault WHERE id=?', (identifier,)).fetchone()
            if row is None:
                raise ValueError('Credential does not exist.')
            if row['origin'] != origin:
                raise ValueError('Credential is not authorized for this origin.')
            payload = self._decode(row)
            self._remember(payload)
            return payload

    def _refresh(self, db, replacing=None):
        for row in db.execute('SELECT * FROM vault'):
            ciphertext = bytes(row['ciphertext'])
            if self._loaded.get(row['id']) != ciphertext:
                try:
                    self._remember(self._decode(row))
                except RuntimeError:
                    if row['id'] == replacing:
                        continue
                    raise
                self._loaded[row['id']] = ciphertext

    def _output_secrets(self):
        with self.store.lock, self.store.connect() as db:
            self._refresh(db)
            # Existing protected settings remain where they were; cover them too.
            getters = [(self.store.supervisor_key, 'supervisor.dpapi', 'CLOUD_SUPERVISOR_API_KEY'),
                       (self.store.proxy_token, 'proxy.dpapi', ''),
                       (self.store.discord_token, 'discord.dpapi', 'DISCORD_TOKEN')]
            for getter, filename, variable in getters:
                if not (self.store.directory / filename).exists() and not os.environ.get(variable):
                    continue
                try:
                    secret = getter()
                except Exception:
                    raise RuntimeError('Unable to unlock saved credentials; output is blocked until credentials are repaired.') from None
                if secret:
                    self._secrets.add(secret)
            variants = set(self._secrets)
            for secret in self._secrets:
                variants.add(json.dumps(secret, ensure_ascii=True)[1:-1])
                variants.add(json.dumps(secret, ensure_ascii=False)[1:-1])
            return sorted(variants, key=len, reverse=True)

    def text_stream(self):
        return CredentialTextStream(self._output_secrets())

    def redact(self, value, schema=None):
        secrets = self._output_secrets()
        def text(value):
            for secret in secrets:
                value = value.replace(secret, REMOVED)
            return pattern_redact(value)
        def visit(item):
            if isinstance(item, str):
                return text(item)
            if isinstance(item, BaseException):
                return text(str(item))
            if isinstance(item, bytes):
                return text(item.decode('utf-8', errors='replace'))
            if isinstance(item, (list, tuple)):
                return [visit(child) for child in item]
            if isinstance(item, dict):
                return {text(str(key)): visit(child) for key, child in item.items()}
            return item
        return boundary(value, schema, visit)
