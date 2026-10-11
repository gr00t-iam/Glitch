from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable


PIPER_RELEASE_URL = (
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/"
    "piper_windows_amd64.zip"
)
VOICE_BASE_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
    "en/en_US/amy/medium"
)
VOICE_MODEL_URL = f"{VOICE_BASE_URL}/en_US-amy-medium.onnx?download=true"
VOICE_CONFIG_URL = f"{VOICE_BASE_URL}/en_US-amy-medium.onnx.json?download=true"
PIPER_TIMEOUT_SECONDS = 60
DOWNLOAD_TIMEOUT_SECONDS = 120

WORKSPACE_ROOT = Path(os.getcwd()).resolve()
PIPER_DIR = WORKSPACE_ROOT / ".nexus_bin" / "piper"
PIPER_EXECUTABLE = PIPER_DIR / "piper.exe"
PIPER_MODEL = PIPER_DIR / "en_US-amy-medium.onnx"
PIPER_CONFIG = PIPER_DIR / "en_US-amy-medium.onnx.json"
CACHE_DIR = WORKSPACE_ROOT / "cache"
LATEST_WAV = CACHE_DIR / "latest_response.wav"
_generation_lock = threading.Lock()

Downloader = Callable[[str, Path], None]


def _download_file(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".part")
    partial.unlink(missing_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "NexusHarness/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def _extract_piper_archive(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if os.path.commonpath([str(root), str(target)]) != str(root):
                raise ValueError("Piper archive contains an unsafe path.")
        archive.extractall(destination)


def ensure_piper_assets(downloader: Downloader | None = None) -> bool:
    """Install Piper and Amy into the workspace when they are not already present."""
    download = downloader or _download_file
    try:
        PIPER_DIR.mkdir(parents=True, exist_ok=True)
        if not PIPER_EXECUTABLE.is_file():
            archive_path = PIPER_DIR.parent / "piper_windows_amd64.zip"
            download(PIPER_RELEASE_URL, archive_path)
            _extract_piper_archive(archive_path, PIPER_DIR.parent)
            archive_path.unlink(missing_ok=True)
        if not PIPER_MODEL.is_file():
            download(VOICE_MODEL_URL, PIPER_MODEL)
        if not PIPER_CONFIG.is_file():
            download(VOICE_CONFIG_URL, PIPER_CONFIG)
        return PIPER_EXECUTABLE.is_file() and PIPER_MODEL.is_file() and PIPER_CONFIG.is_file()
    except (OSError, ValueError, urllib.error.URLError, zipfile.BadZipFile):
        logging.warning("Piper voice setup could not finish.")
        return False


def generate_piper_speech(text: str) -> bytes | None:
    if not PIPER_EXECUTABLE.is_file() or not PIPER_MODEL.is_file() or not PIPER_CONFIG.is_file():
        logging.warning("Piper voice files are missing.")
        return None

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with _generation_lock:
        output_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(prefix="nexus-piper-", suffix=".wav", dir=CACHE_DIR, delete=False) as output:
                output_path = Path(output.name)

            completed = subprocess.run(
                [
                    str(PIPER_EXECUTABLE),
                    "--model",
                    str(PIPER_MODEL),
                    "--output_file",
                    str(output_path),
                ],
                input=text.encode("utf-8"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                shell=False,
                timeout=PIPER_TIMEOUT_SECONDS,
                check=False,
            )
            if completed.returncode != 0 or not output_path.is_file():
                logging.warning("Piper could not create the voice audio.")
                return None
            output_path.replace(LATEST_WAV)
            output_path = None
            return LATEST_WAV.read_bytes()
        except (FileNotFoundError, OSError, subprocess.SubprocessError):
            logging.warning("Piper could not start.")
            return None
        finally:
            if output_path:
                output_path.unlink(missing_ok=True)
