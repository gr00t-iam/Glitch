"""Narrow native bridge exposed only to the bundled application page."""

import threading


class DesktopAPI:
    def __init__(self, store, engine, models):
        self._store, self._engine, self._models = store, engine, models
        self._window = None
        self._discord = None
        self._picker_lock = threading.Lock()

    def bootstrap(self):
        return {'settings': self._store.settings(), 'sessions': self._store.sessions(),
                'runtime': self._engine.state(), 'discord': self._discord.status() if self._discord else {},
                'startup_warnings': list(self._store.startup_warnings)}

    def choose_workspace(self):
        import webview
        if self._engine.state()['running_session']:
            raise ValueError('Stop the active task before switching projects.')
        with self._picker_lock:
            selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        if not selected:
            return None
        return self._store.session(self._store.new_session(selected[0]))

    def new_conversation(self, session):
        if self._engine.state()['running_session']:
            raise ValueError('Stop the active task first.')
        return self._store.session(self._store.new_session(self._store.session(session)['workspace']))

    def load_conversation(self, session):
        self._store.session(session)
        return {'messages': [m for m in self._store.messages(session) if m['role'] != 'context'], 'events': self._store.events(session, 0)}

    def save_settings(self, update):
        if self._engine.state()['running_session']:
            raise ValueError('Stop the active task before changing configuration.')
        before = self._store.settings()
        result = self._store.save_settings(update)
        if any(result[key] != before[key] for key in ('worker_model', 'context_length', 'cpu_threads', 'temperature', 'vision_projector')):
            self._models.unload()
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
        return {'ok': True}

    def stop(self):
        self._engine.stop()
        return {'ok': True}

    def approve(self, identifier, approved):
        self._engine.resolve_approval(identifier, approved)
        return {'ok': True}

    def poll(self, session, after):
        self._store.session(session)
        return {'events': self._store.events(session, after), 'runtime': self._engine.state(),
                'discord': self._discord.status() if self._discord else {}}

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
