"""Local literal-text Windows speech, with bounded completion announcements."""
import queue
import re
import threading
import time
from glitch.storage import redact


def spoken_report(text):
    text = re.sub(r'```[\s\S]*?```|`[^`]*`|https?://\S+', '', str(text))
    text = redact(text)
    text = re.sub(r'[*#_<>]', '', text)
    return ' '.join(text.split())[:600]


class SpeechOutputService:
    def __init__(self, audio, settings, secrets=None, redactor=None):
        self.audio, self.settings = audio, settings
        self.secrets = secrets or (lambda: [])
        self.redactor = redactor or redact
        self.lock = threading.Lock()
        self.commands = queue.Queue(maxsize=8)
        self.closed = threading.Event()
        self.purge = threading.Event()
        self.seen = set()
        self.snapshot = {'phase': 'off', 'voices': [], 'error': ''}
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def status(self):
        with self.lock:
            return {**self.snapshot, 'voices': list(self.snapshot['voices'])}

    def voices(self):
        return self.status()['voices']

    def speak(self, text, automatic=False):
        for secret in self.secrets():
            if secret:
                text = str(text).replace(secret, '[credential removed]')
        text = spoken_report(getattr(self, 'redactor', redact)(str(text)))
        if text:
            try:
                self.commands.put_nowait((text, automatic))
            except queue.Full:
                raise ValueError('Too many spoken reports are waiting. Stop speaking to clear them.')

    def on_completed(self, event):
        if event.get('parent_id') or not self.settings().get('announce_completed_tasks'):
            return
        identifier = event.get('id')
        with self.lock:
            if not identifier or identifier in self.seen:
                return
            self.seen.add(identifier)
        self.speak(event.get('text', ''), automatic=True)

    def stop(self):
        self.purge.set()
        while True:
            try:
                self.commands.get_nowait()
            except queue.Empty:
                break

    def _loop(self):
        initialized = False
        try:
            import comtypes
            import comtypes.client
            comtypes.CoInitialize()
            initialized = True
            voice = comtypes.client.CreateObject('SAPI.SpVoice', dynamic=True)
            tokens = voice.GetVoices()
            voices = [{'id': str(tokens.Item(i).Id), 'name': str(tokens.Item(i).GetDescription())} for i in range(tokens.Count)]
            with self.lock:
                self.snapshot['voices'] = voices
            while not self.closed.is_set():
                if self.purge.is_set():
                    voice.Speak('', 1 | 2 | 16)
                    self.purge.clear()
                try:
                    text, automatic = self.commands.get(timeout=.1)
                except queue.Empty:
                    continue
                settings = self.settings()
                if automatic and not settings.get('announce_completed_tasks'):
                    continue
                while not self.audio.begin_playback():
                    if self.closed.wait(.1) or self.purge.is_set():
                        break
                if self.closed.is_set() or self.purge.is_set():
                    self.audio.end_playback()
                    continue
                try:
                    chosen = settings.get('speech_voice_id')
                    if chosen:
                        match = next((i for i, item in enumerate(voices) if item['id'] == chosen), None)
                        if match is None:
                            raise ValueError('The selected Windows voice is no longer installed.')
                        voice.Voice = tokens.Item(match)
                    voice.Volume = settings.get('speech_volume', 80)
                    voice.Rate = settings.get('speech_rate', 0)
                    with self.lock:
                        self.snapshot.update(phase='speaking', error='')
                    # Async + not XML: model output cannot be SSML or a file reference.
                    voice.Speak(text, 1 | 16)
                    while not voice.WaitUntilDone(50):
                        if self.closed.is_set() or self.purge.is_set():
                            voice.Speak('', 1 | 2 | 16)
                            self.purge.clear()
                            break
                except Exception as error:
                    with self.lock:
                        self.snapshot['error'] = str(error)
                finally:
                    self.audio.end_playback()
                    with self.lock:
                        self.snapshot['phase'] = 'off'
            voice.Speak('', 1 | 2 | 16)
        except Exception as error:
            with self.lock:
                self.snapshot.update(phase='error', error=str(error))
        finally:
            if initialized:
                comtypes.CoUninitialize()

    def close(self):
        self.stop()
        self.closed.set()
        self.thread.join(timeout=5)
