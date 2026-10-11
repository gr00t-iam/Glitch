"""User-initiated GGUF transfers. Partial or unverified files never enter the catalog."""

import hashlib
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from urllib.parse import urlsplit, unquote, urljoin

import requests

MAX_BYTES = 128 * 1024 ** 3


def validate_download_url(value, redirect=False):
    url = urlsplit(value)
    host = (url.hostname or '').lower()
    allowed = host == 'huggingface.co' or (redirect and (
        host.endswith('.huggingface.co') or host == 'hf.co' or host.endswith('.hf.co')))
    if (url.scheme != 'https' or not allowed or url.username is not None or
            url.password is not None or url.fragment or (url.query and not redirect) or
            url.port not in (None, 443)):
        raise ValueError('Use a public HTTPS Hugging Face GGUF file URL without credentials or query parameters.')
    name = unquote(url.path.rsplit('/', 1)[-1])
    if not redirect and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.gguf', name, re.I) or
                         re.search(r'-\d{5}-of-\d{5}\.gguf$', name, re.I)):
        raise ValueError('Choose a single GGUF file, not a repository page or split model part.')
    return name


def verify_gguf(path):
    with Path(path).open('rb') as stream:
        header = stream.read(24)
    if len(header) < 24 or header[:4] != b'GGUF' or int.from_bytes(header[4:8], 'little') not in (2, 3):
        raise ValueError('This download is not a supported GGUF file. Check the file URL.')


class ModelManager:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._thread = None
        self._state = {'phase': 'idle', 'name': '', 'received': 0, 'total': 0, 'message': 'Ready'}

    def status(self):
        with self._lock:
            return dict(self._state)

    def _update(self, **values):
        with self._lock:
            self._state.update(values)

    def path(self, name):
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,180}\.gguf', name, re.I):
            raise ValueError('Select a GGUF file from the model library.')
        path = (self.directory / name).resolve(strict=True)
        if path.parent != self.directory or not path.is_file():
            raise ValueError('Model is outside the local library.')
        verify_gguf(path)
        return path

    def catalog(self):
        result = []
        for file in sorted(self.directory.glob('*.gguf')):
            try:
                path = self.path(file.name)
                result.append({'name': file.name, 'size': path.stat().st_size})
            except (ValueError, OSError):
                continue
        return result

    def _start(self, name, transfer, expected=''):
        expected = expected.strip().lower()
        if expected and not re.fullmatch('[0-9a-f]{64}', expected):
            raise ValueError('SHA256 must contain exactly 64 hexadecimal characters.')
        with self._lock:
            if self._thread and self._thread.is_alive():
                raise ValueError('A model transfer is already running.')
            if (self.directory / name).exists():
                raise ValueError('That model already exists. Choose a different file or delete it first.')
            self._cancel.clear()
            self._state = {'phase': 'downloading', 'name': name, 'received': 0, 'total': 0, 'message': 'Starting transfer...'}
            self._thread = threading.Thread(target=self._run, args=(name, transfer, expected), daemon=True)
            self._thread.start()
        return self.status()

    def download(self, url, expected=''):
        name = validate_download_url(url)
        return self._start(name, lambda: self._remote(url), expected)

    def import_file(self, source):
        source = Path(source).resolve(strict=True)
        name = source.name
        validate_download_url('https://huggingface.co/import/' + name)
        verify_gguf(source)
        def chunks():
            self._update(total=source.stat().st_size)
            with source.open('rb') as stream:
                while data := stream.read(1024 * 1024):
                    yield data
        return self._start(name, chunks)

    def _remote(self, url):
        response = None
        try:
            for _ in range(7):
                validate_download_url(url, redirect=True)
                response = requests.get(url, stream=True, timeout=(15, 30), allow_redirects=False,
                                        headers={'Accept-Encoding': 'identity'})
                if response.status_code in (301, 302, 303, 307, 308):
                    url = urljoin(url, response.headers.get('Location', ''))
                    response.close()
                    response = None
                    continue
                if response.status_code != 200:
                    raise RuntimeError(f'Download returned HTTP {response.status_code}. Use a public, ungated GGUF file.')
                total = int(response.headers.get('Content-Length', 0))
                if total > MAX_BYTES or (total and total > shutil.disk_usage(self.directory).free - 256 * 1024 ** 2):
                    raise ValueError('Not enough disk space, or the model exceeds the 128 GB transfer limit.')
                self._update(total=total)
                yield from response.iter_content(1024 * 1024)
                return
            raise RuntimeError('Too many download redirects.')
        finally:
            if response is not None:
                response.close()

    def _run(self, name, transfer, expected):
        temporary = self.directory / (uuid.uuid4().hex + '.part')
        received, digest = 0, hashlib.sha256()
        try:
            with temporary.open('xb') as output:
                for chunk in transfer():
                    if self._cancel.is_set():
                        raise InterruptedError('Transfer canceled.')
                    if not chunk:
                        continue
                    received += len(chunk)
                    if received > MAX_BYTES:
                        raise ValueError('Transfer exceeds the 128 GB limit.')
                    output.write(chunk)
                    digest.update(chunk)
                    self._update(received=received, message='Downloading model...')
                output.flush()
                os.fsync(output.fileno())
            if self._cancel.is_set():
                raise InterruptedError('Transfer canceled.')
            total = self.status()['total']
            if total and total != received:
                raise ValueError('Incomplete transfer. Retry the download.')
            self._update(phase='verifying', message='Checking file integrity...')
            verify_gguf(temporary)
            checksum = digest.hexdigest()
            if expected and checksum != expected:
                raise ValueError('SHA256 does not match. The model was not saved.')
            # os.rename on Windows refuses to overwrite a concurrently-created destination.
            os.rename(temporary, self.directory / name)
            self._update(phase='complete', message='Model saved. Select it and click Load model.', sha256=checksum)
        except InterruptedError:
            self._update(phase='canceled', message='Transfer canceled. No partial model was saved.')
        except Exception as error:
            message = str(error) if isinstance(error, (ValueError, RuntimeError)) else 'Transfer failed. Check your connection, URL and disk space.'
            self._update(phase='error', message=message)
        finally:
            temporary.unlink(missing_ok=True)

    def cancel(self):
        self._cancel.set()

    def wait(self, timeout=5):
        if self._thread:
            self._thread.join(timeout)

    def delete(self, name):
        if self.status()['phase'] in ('downloading', 'verifying'):
            raise ValueError('Wait for the current transfer to finish.')
        self.path(name).unlink()
