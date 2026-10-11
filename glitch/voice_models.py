"""One-time offline recognizer setup; audio is never uploaded."""
import shutil
import threading
from pathlib import Path
from glitch.runtime_assets import fetch_archive, safe_extract

VOICE_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip'
# Pinned after verifying the initial publisher download; see voice model provenance.
VOICE_SHA256 = '30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'


class VoiceModelManager:
    def __init__(self, directory):
        self.directory = Path(directory) / 'voice'
        self.path = self.directory / 'vosk-model-small-en-us-0.15'
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.thread = None
        self.snapshot = {'phase': 'ready' if self.model_path() else 'missing', 'received': 0, 'total': 0, 'message': 'Offline speech model'}

    def model_path(self):
        return self.path if (self.path / 'am' / 'final.mdl').is_file() and (self.path / 'conf' / 'model.conf').is_file() else None

    def status(self):
        with self.lock:
            return dict(self.snapshot)

    def start_download(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('Speech model setup is already running.')
            if self.model_path():
                return
            self.cancelled.clear()
            self.snapshot.update(phase='downloading', message='Downloading offline speech model...')
            self.thread = threading.Thread(target=self._download, daemon=True)
            self.thread.start()

    def _download(self):
        staging = self.directory / 'setup'
        try:
            staging.mkdir(parents=True, exist_ok=True)
            def progress(received, total):
                with self.lock:
                    self.snapshot.update(received=received, total=total)
            if not VOICE_SHA256:
                raise RuntimeError('Speech model checksum has not been pinned in this build.')
            fetch_archive(VOICE_URL, staging / 'model.zip', VOICE_SHA256, self.cancelled, progress, 128 * 1024 ** 2)
            safe_extract(staging / 'model.zip', staging / 'extracted', 256 * 1024 ** 2)
            if self.cancelled.is_set():
                raise InterruptedError('Speech model setup cancelled.')
            candidate = staging / 'extracted' / self.path.name
            if not (candidate / 'am' / 'final.mdl').is_file() or not (candidate / 'conf' / 'model.conf').is_file():
                raise ValueError('Speech model archive is incomplete.')
            candidate.rename(self.path)
            with self.lock:
                self.snapshot.update(phase='ready', message='Offline voice is ready')
        except Exception as error:
            with self.lock:
                self.snapshot.update(phase='error', message=str(error))
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    def cancel(self):
        self.cancelled.set()

    def close(self):
        self.cancel()
        if self.thread:
            self.thread.join(timeout=2)
