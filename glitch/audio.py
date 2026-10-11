"""Exclusive offline microphone state machine with opt-in wake activation."""
import json
import queue
import threading
import time
import uuid
from glitch.voice_models import VoiceModelManager


def wake_match(result):
    words = result.get('result', [])
    return (result.get('text', '').strip().lower() == 'hey glitch' and len(words) == 2 and
            all(float(word.get('conf', 0)) >= .85 for word in words))


class AudioCoordinator:
    def __init__(self, directory, conversation=None):
        self.models = VoiceModelManager(directory)
        self.conversation = conversation or (lambda: None)
        self.lock = threading.RLock()
        self.closed = threading.Event()
        self.changed = threading.Event()
        self.capture_closed = threading.Event()
        self.capture_closed.set()
        self._generation = ''
        self._session = None
        self._mode = 'off'
        self._wake = False
        self._speaking = False
        self._command = None
        self._interim = ''
        self._final = ''
        self._error = ''
        self._cooldown = 0
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def status(self):
        with self.lock:
            return {'phase': 'speaking' if self._speaking else self._mode, 'wake_enabled': self._wake,
                    'generation_id': self._generation, 'conversation_id': self._session,
                    'interim': self._interim, 'final': self._final, 'error': self._error,
                    'model': self.models.status()}

    def _publish(self, generation, **values):
        with self.lock:
            if generation != self._generation:
                return
            for name, value in values.items():
                setattr(self, '_' + name, value)

    def start(self, session):
        if not isinstance(session, str) or not session:
            raise ValueError('Choose a conversation before dictating.')
        if not self.models.model_path():
            raise ValueError('Set up offline voice in Settings first.')
        with self.lock:
            if self._speaking or self._mode == 'dictating':
                raise ValueError('Voice is already busy.')
            self._generation = uuid.uuid4().hex
            self._session = session
            self._interim = self._final = self._error = ''
            self._command = None
            self._mode = 'dictating'
            self.changed.set()
            return self._generation

    def stop(self, generation=None):
        with self.lock:
            if generation and generation != self._generation:
                return
            if self._mode == 'dictating':
                self._command = 'stop'
                self.changed.set()

    def cancel(self, generation=None):
        with self.lock:
            if generation and generation != self._generation:
                return
            self._generation = uuid.uuid4().hex
            self._final = self._interim = ''
            self._mode = 'off'
            self._command = 'cancel'
            self._cooldown = time.monotonic() + 3
            self.changed.set()

    def set_wake_enabled(self, enabled):
        if type(enabled) is not bool:
            raise ValueError('Hands-free listening must be on or off.')
        if enabled and not self.models.model_path():
            raise ValueError('Set up offline voice first.')
        with self.lock:
            self._wake = enabled
            self._error = ''
            if not enabled and self._mode == 'listening':
                self._mode = 'off'
            self.changed.set()

    def mute(self):
        self.set_wake_enabled(False)
        self.cancel()

    def begin_playback(self):
        with self.lock:
            if self.closed.is_set() or self._mode == 'dictating':
                return False
            self._speaking = True
            self.changed.set()
        if not self.capture_closed.wait(3):
            self.end_playback()
            return False
        return True

    def end_playback(self):
        with self.lock:
            self._speaking = False
            self._mode = 'off'
            self._cooldown = time.monotonic() + 3
            self.changed.set()

    def _loop(self):
        model = None
        while not self.closed.is_set():
            with self.lock:
                mode = self._mode
                if mode != 'dictating':
                    mode = 'listening' if self._wake and not self._speaking and time.monotonic() >= self._cooldown and not self._error else 'off'
                    self._mode = mode
                generation = self._generation
                if mode != 'off':
                    self.capture_closed.clear()
            if mode == 'off':
                self.changed.wait(.2)
                self.changed.clear()
                continue
            try:
                import vosk
                import sounddevice as sd
                if model is None:
                    vosk.SetLogLevel(-1)
                    model = vosk.Model(str(self.models.model_path()))
                rate = int(sd.query_devices(kind='input')['default_samplerate'])
                recognizer = (vosk.KaldiRecognizer(model, rate, json.dumps(['hey glitch', '[unk]']))
                              if mode == 'listening' else vosk.KaldiRecognizer(model, rate))
                recognizer.SetWords(True)
                chunks = queue.Queue(maxsize=64)
                overflow = threading.Event()
                def capture(data, frames, timing, flags):
                    if flags:
                        overflow.set()
                    try:
                        chunks.put_nowait(bytes(data))
                    except queue.Full:
                        overflow.set()
                started = last_speech = time.monotonic()
                had_speech = False
                with self.lock:
                    if self._speaking or self._mode != mode or generation != self._generation:
                        continue
                with sd.RawInputStream(samplerate=rate, blocksize=max(1024, rate // 10), dtype='int16', channels=1, callback=capture):
                    while not self.closed.is_set():
                        with self.lock:
                            if self._speaking or self._mode != mode or generation != self._generation:
                                break
                            command = self._command
                        if overflow.is_set():
                            raise RuntimeError('Microphone audio overflow. Try again.')
                        now = time.monotonic()
                        finish = command == 'stop' or (mode == 'dictating' and (now - started >= 120 or
                                 (had_speech and now - last_speech >= 2) or (not had_speech and now - started >= 10)))
                        if finish:
                            self._append(generation, json.loads(recognizer.FinalResult()).get('text', ''))
                            with self.lock:
                                if generation == self._generation:
                                    self._interim = ''
                                    self._mode = 'off'
                                    self._command = None
                                    self._cooldown = now + 3
                            break
                        try:
                            data = chunks.get(timeout=.1)
                        except queue.Empty:
                            continue
                        if recognizer.AcceptWaveform(data):
                            result = json.loads(recognizer.Result())
                            if mode == 'listening' and wake_match(result):
                                session = self.conversation()
                                self.start(session)
                                break
                            if mode == 'dictating':
                                text = result.get('text', '')
                                if text:
                                    had_speech = True
                                    last_speech = now
                                self._append(generation, text)
                        elif mode == 'dictating':
                            partial = json.loads(recognizer.PartialResult()).get('partial', '')
                            if partial and partial != self.status()['interim']:
                                last_speech = now
                                had_speech = True
                            self._publish(generation, interim=partial)
            except Exception as error:
                with self.lock:
                    self._error = str(error)
                    self._mode = 'off'
                    self._interim = ''
            finally:
                self.capture_closed.set()

    def _append(self, generation, text):
        with self.lock:
            if generation == self._generation and text:
                self._final = (self._final + ' ' + text).strip()[:20000]
                self._interim = ''

    def close(self):
        self.closed.set()
        self.changed.set()
        self.thread.join(timeout=5)
        self.models.close()
