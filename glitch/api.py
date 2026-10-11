"""Narrow native bridge exposed only to the bundled application page."""

import threading
from functools import wraps


def _redacted_bridge(cls):
    """Cover every public native result/exception, including future bridge methods."""
    def guard(method):
        @wraps(method)
        def invoke(self, *args, **kwargs):
            try:
                result = method(self, *args, **kwargs)
                return result if method.__name__ in ('screenshot', 'vault_list') else self._store.redact(result)
            except Exception as error:
                try:
                    message = self._store.redact(str(error))
                except Exception:
                    message = 'Credential protection failed. Repair or remove unreadable saved credentials.'
                raise ValueError(message) from None
        return invoke
    for name, method in list(vars(cls).items()):
        # Image bytes are not text. Metadata-only listing remains available for recovery.
        if not name.startswith('_') and callable(method):
            setattr(cls, name, guard(method))
    return cls


@_redacted_bridge
class DesktopAPI:
    def __init__(self, store, engine, models):
        self._store, self._engine, self._models = store, engine, models
        self._window = None
        self._discord = None
        self._picker_lock = threading.Lock()
        self._audio = None
        self._speech = None
        self._voice_session = None

    def bootstrap(self):
        return {'settings': self._store.settings(), 'sessions': self._store.sessions(),
                'runtime': self._engine.state(), 'discord': self._discord.status() if self._discord else {},
                'startup_warnings': list(self._store.startup_warnings), 'voice': self.voice_status(),
                'vault': self.vault_list()}

    def vault_list(self):
        return self._store.vault.list()

    def vault_save(self, name, kind, origin, payload, identifier=None):
        # Use the same lock as run admission, including Discord/delegated starts.
        with self._engine.lock:
            self._vault_idle()
            return self._store.vault.save(name, kind, origin, payload, identifier)

    def vault_delete(self, identifier):
        with self._engine.lock:
            self._vault_idle()
            self._store.vault.delete(identifier)
            return {'ok': True}

    def _vault_idle(self):
        if hasattr(self._engine, 'is_idle'):
            busy = not self._engine.is_idle()
        else:
            state = self._engine.state()
            busy = state['running_session'] or state.get('active_sessions') or state.get('approval') or state.get('approvals')
        if busy:
            raise ValueError('Stop all active tasks before changing vault credentials.')

    def choose_workspace(self):
        import webview
        if self._engine.state()['running_session'] and not hasattr(self._engine, 'active_session'):
            raise ValueError('Stop the active task before switching projects.')
        with self._picker_lock:
            selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return None
        return self._store.session(self._store.new_session(selected[0]))

    def new_conversation(self, session=None):
        if self._engine.state()['running_session'] and not hasattr(self._engine, 'active_session'):
            raise ValueError('Stop the active task first.')
        if session:
            workspace = self._store.session(session)['workspace']
        else:
            import uuid
            workspace = self._store.directory / 'workspaces' / ('Chat-' + uuid.uuid4().hex[:12])
            workspace.mkdir(parents=True, exist_ok=False)
        return self._store.session(self._store.new_session(workspace))

    def load_conversation(self, session):
        self._store.session(session)
        return {'messages': [m for m in self._store.messages(session) if m['role'] != 'context'], 'events': self._store.events(session, 0)}

    def save_settings(self, update):
        if self._engine.state()['running_session']:
            raise ValueError('Stop the active task before changing configuration.')
        before = self._store.settings()
        if update.get('wake_word_enabled') and self._audio and not self._audio.models.model_path():
            raise ValueError('Set up offline voice before enabling Hey Glitch.')
        if update.get('speech_voice_id') and self._speech and update['speech_voice_id'] not in {v['id'] for v in self._speech.voices()}:
            raise ValueError('Choose an installed Windows voice.')
        result = self._store.save_settings(update)
        if any(result[key] != before[key] for key in ('worker_model', 'context_length', 'cpu_threads', 'temperature', 'vision_projector', 'parallel_streams', 'gpu_mode')):
            self._models.unload()
        if self._audio and result['wake_word_enabled'] != before['wake_word_enabled']:
            self._audio.set_wake_enabled(result['wake_word_enabled'])
        if self._speech and not result['announce_completed_tasks']:
            self._speech.stop()
        if self._discord and (update.get('discord_token') or update.get('clear_discord_token') or
                              any(result[k] != before[k] for k in ('discord_user_id', 'discord_channel_id'))):
            self._discord.stop()
        return result

    def discover_models(self):
        return self._models.discover(self._store.settings())

    def model_status(self):
        return self._models.status()

    def download_model(self, url, sha256=''):
        return self._models.library.download(url, sha256)

    def cancel_model_transfer(self):
        self._models.library.cancel()
        return {'ok': True}

    def _idle(self):
        if self._engine.state()['running_session']:
            raise ValueError('Stop the active task before changing the loaded model.')

    def import_model(self):
        import webview
        with self._picker_lock:
            selected = self._window.create_file_dialog(webview.FileDialog.OPEN, file_types=('GGUF models (*.gguf)',))
        return self._models.library.import_file(selected[0]) if selected else None

    def load_model(self):
        self._idle()
        return self._models.load(self._store.settings())

    def unload_model(self):
        self._idle()
        self._models.unload()
        return {'ok': True}

    def delete_model(self, name):
        self._idle()
        if self._models.worker.status()['name'] == name:
            raise ValueError('Unload the model before deleting it.')
        if self._store.settings()['vision_projector'] == name and self._models.worker.status()['name']:
            raise ValueError('Unload the model before deleting its projector.')
        self._models.library.delete(name)
        return {'ok': True}

    def test_supervisor(self):
        return self._models.supervisor.test(self._store.settings())

    def open_proxy_login(self):
        import webbrowser
        from glitch.supervisor import loopback_url
        url = loopback_url(self._store.settings()['proxy_login_url'])
        return {'ok': bool(webbrowser.open(url)), 'message': 'Complete sign-in in your authorized bridge, then test the connection here.'}

    def send(self, session, prompt):
        self._engine.start(session, prompt)
        return {'ok': True, 'prompt': self._store.redact(prompt)}

    def spawn_agent(self, session, role, task):
        if not hasattr(self._engine, 'active_session'):
            raise ValueError('Parallel agents require the shared runtime.')
        workspace = self._store.session(session)['workspace'] if session else self.new_conversation()['workspace']
        new_session = self._store.new_session(workspace)
        identifier = self._engine.start(new_session, task, role=role)
        return {'run_id': identifier, 'session': self._store.session(new_session)}

    def stop(self, run_id=None):
        if hasattr(self._engine, 'active_session'):
            self._engine.stop(run_id)
        else:
            self._engine.stop()
        return {'ok': True}

    def approve(self, identifier, approved):
        self._engine.resolve_approval(identifier, approved)
        return {'ok': True}

    def poll(self, session, after):
        self._store.session(session)
        return {'events': self._store.events(session, after), 'runtime': self._engine.state(),
                'discord': self._discord.status() if self._discord else {}, 'voice': self.voice_status()}

    def voice_status(self):
        return {'input': self._audio.status() if self._audio else {'phase': 'off', 'model': {'phase': 'missing'}},
                'output': self._speech.status() if self._speech else {'phase': 'off', 'voices': []}}

    def voice_select_session(self, session):
        self._store.session(session)
        if self._audio and self._voice_session != session:
            self._audio.cancel()
        self._voice_session = session
        return {'ok': True}

    def _voice(self):
        if not self._audio:
            raise ValueError('Voice service is unavailable in this build.')
        return self._audio

    def setup_voice(self):
        self._voice().models.start_download()
        return {'ok': True}

    def cancel_voice_setup(self):
        self._voice().models.cancel()
        return {'ok': True}

    def start_dictation(self, session):
        self._store.session(session)
        self._voice_session = session
        return {'generation_id': self._voice().start(session)}

    def stop_dictation(self, generation=None):
        self._voice().stop(generation)
        return {'ok': True}

    def cancel_dictation(self, generation=None):
        self._voice().cancel(generation)
        return {'ok': True}

    def mute_voice(self):
        self._voice().mute()
        if self._speech:
            self._speech.stop()
        self._store.save_settings({'wake_word_enabled': False})
        return {'ok': True}

    def test_voice(self):
        if not self._speech:
            raise ValueError('Speech service is unavailable.')
        self._speech.speak('Hello. I am Glitch. I can let you know when your task is finished.')
        return {'ok': True}

    def stop_speaking(self):
        if self._speech:
            self._speech.stop()
        return {'ok': True}

    def read_latest_reply(self, session):
        self._store.session(session)
        if not self._speech:
            raise ValueError('Speech service is unavailable.')
        reply = next((m['content'] for m in reversed(self._store.messages(session)) if m['role'] == 'assistant'), '')
        self._speech.speak(reply)
        return {'ok': True}

    def connect_discord(self):
        return self._discord.start()

    def disconnect_discord(self):
        self._discord.stop()
        return self._discord.status()

    def screenshot(self, path):
        import base64
        from pathlib import Path
        target = Path(path).resolve(strict=True)
        if not target.is_relative_to((self._store.directory / 'captures').resolve()) or target.suffix != '.png':
            raise ValueError('Invalid capture path.')
        return base64.b64encode(target.read_bytes()).decode()
