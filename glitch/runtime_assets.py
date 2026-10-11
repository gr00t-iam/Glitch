"""Verified build assets and confined archive extraction."""
import hashlib
import os
import shutil
import stat
import sys
import re
import subprocess
import zipfile
from pathlib import Path
import requests

RUNTIME_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11552/llama-b11552-bin-win-cpu-x64.zip'
RUNTIME_SHA256 = 'c00741179811ff903b515eae28bdeef1f47af6e81c49920c4e68b62954e056d6'
CUDA_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11552/llama-b11552-bin-win-cuda-12.4-x64.zip'
CUDA_SHA256 = 'e48331718aa82aa34571cfad8510e6d6b9a8e4dad11a73e065f94f212e280256'
CUDART_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b11552/cudart-llama-bin-win-cuda-12.4-x64.zip'
CUDART_SHA256 = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'


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


def runtime_directory(backend='cpu'):
    return Path(__file__).resolve().parent / 'runtime' / ('llama-cpp-cuda' if backend == 'cuda' else 'llama-cpp')


def select_runtime(mode='auto'):
    if mode not in ('auto', 'cpu', 'cuda'):
        raise ValueError('Invalid processing backend.')
    binary = runtime_directory('cuda') / 'llama-server.exe'
    if mode != 'cpu' and binary.is_file():
        try:
            check = subprocess.run([str(binary), '--list-devices'], capture_output=True, timeout=20,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            if check.returncode == 0 and re.search(rb'CUDA\d+:', check.stdout + check.stderr):
                return binary, 'cuda'
        except (OSError, subprocess.TimeoutExpired):
            pass
    if mode == 'cuda':
        raise RuntimeError('NVIDIA processing is unavailable. Check your NVIDIA driver or choose Automatic / CPU.')
    return runtime_directory() / 'llama-server.exe', 'cpu'


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


def prepare_cuda_runtime():
    destination = runtime_directory('cuda')
    marker = destination / 'archive.sha256'
    expected = CUDA_SHA256 + '\n' + CUDART_SHA256
    if (destination / 'llama-server.exe').is_file() and marker.is_file() and marker.read_text().strip() == expected:
        return destination
    staging = destination.with_name(destination.name + '.staging')
    staging.mkdir(parents=True, exist_ok=True)
    try:
        for name, url, checksum in [('server', CUDA_URL, CUDA_SHA256), ('dlls', CUDART_URL, CUDART_SHA256)]:
            archive = staging / (name + '.zip')
            fetch_archive(url, archive, checksum)
            safe_extract(archive, staging / name)
        destination.mkdir(parents=True, exist_ok=True)
        server = next((staging / 'server').rglob('llama-server.exe'), None)
        if not server:
            raise ValueError('CUDA archive has no server executable.')
        for file in server.parent.iterdir():
            if file.is_file():
                shutil.copy2(file, destination / file.name)
        for file in (staging / 'dlls').rglob('*.dll'):
            shutil.copy2(file, destination / file.name)
        marker.write_text(expected, encoding='ascii')
        return destination
    finally:
        shutil.rmtree(staging, ignore_errors=True)
