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
                'runtime': self._engine.state(), 'discord': self._discord.status() if self._discord else {}}

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
        if self._discord and (update.get('discord_token') or update.get('clear_discord_token') or
                              any(result[k] != before[k] for k in ('discord_user_id', 'discord_channel_id'))):
            self._discord.stop()
        return result

    def discover_models(self):
        return self._models.discover(self._store.settings())

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
