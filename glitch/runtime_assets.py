"""Verified build assets and confined archive extraction."""
import hashlib
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path
import requests

RUNTIME_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11552/llama-b11552-bin-win-cpu-x64.zip'
RUNTIME_SHA256 = 'c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6'


def safe_extract(archive: Path, destination: Path, limit: int = 1024 ** 3):
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if len(members) > 10000 or sum(m.file_size for m in members) > limit:
            raise ValueError('Archive is too large.')
        for member in members:
            name = member.filename.replace('\\', '/')
            target = (destination / name).resolve()
            if (':' in name or name.startswith('/') or '..' in name.split('/') or
                    not target.is_relative_to(destination) or stat.S_ISLNK(member.external_attr >> 16)):
                raise ValueError('Unsafe archive member.')
        source.extractall(destination)


def fetch_archive(url, target, expected, cancel=None, progress=None, limit=512 * 1024 ** 2):
    digest = hashlib.sha256()
    received = 0
    with requests.get(url, stream=True, timeout=(15, 30)) as response:
        response.raise_for_status()
        total = int(response.headers.get('Content-Length', 0))
        if total > limit:
            raise ValueError('Download exceeds the allowed size.')
        with open(target, 'wb') as output:
            for chunk in response.iter_content(256 * 1024):
                if cancel and cancel.is_set():
                    raise InterruptedError('Download cancelled.')
                received += len(chunk)
                if received > limit:
                    raise ValueError('Download exceeds the allowed size.')
                output.write(chunk)
                digest.update(chunk)
                if progress:
                    progress(received, total)
    actual = digest.hexdigest()
    if expected and actual != expected:
        raise ValueError('Download checksum does not match the pinned asset.')
    return actual


def runtime_directory():
    return Path(__file__).resolve().parent / 'runtime' / 'llama-cpp'


def prepare_runtime(destination=None):
    destination = Path(destination or runtime_directory())
    if (destination / 'llama-server.exe').exists() and (destination / 'archive.sha256').is_file() and (destination / 'archive.sha256').read_text().strip() == RUNTIME_SHA256:
        return destination
    staging = destination.with_name(destination.name + '.staging')
    staging.mkdir(parents=True, exist_ok=True)
    archive = staging / 'runtime.zip'
    try:
        fetch_archive(RUNTIME_URL, archive, RUNTIME_SHA256)
        safe_extract(archive, staging / 'contents')
        server = next((staging / 'contents').rglob('llama-server.exe'), None)
        if server is None:
            raise ValueError('Runtime archive has no server executable.')
        destination.mkdir(parents=True, exist_ok=True)
        for item in server.parent.iterdir():
            if item.is_file():
                shutil.copy2(item, destination / item.name)
        (destination / 'archive.sha256').write_text(RUNTIME_SHA256, encoding='ascii')
        return destination
    finally:
        shutil.rmtree(staging, ignore_errors=True)
