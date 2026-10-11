"""Native Windows entry point. Run with python -m glitch.main or Glitch.exe."""

import ctypes
import os
import sys
from pathlib import Path


def show_startup_error(error):
    from glitch.storage import redact
    message = redact(str(error))
    hint = ('\n\nInstall Microsoft Edge WebView2 Runtime and retry.'
            if 'webview2' in message.lower() or 'edgechromium' in message.lower() else '')
    ctypes.windll.user32.MessageBoxW(None, f'Glitch could not start.\n\n{message}{hint}', 'Glitch', 0x10)


def install_navigation_guard(window):
    from System import Action
    if getattr(window, '_glitch_navigation_guard', False):
        return
    window._glitch_navigation_guard = True
    trusted = window.get_current_url()
    def guard(sender, args):
        if str(args.Uri) != trusted:
            args.Cancel = True
    def attach():
        browser = window.native.browser
        def completed(sender, args):
            if args.IsSuccess:
                browser.on_navigation_completed(sender, args)
        # A canceled navigation must not reset the in-page bridge and its pending calls.
        browser.webview.NavigationCompleted -= browser.on_navigation_completed
        browser.webview.NavigationCompleted += completed
        window.native.webview.CoreWebView2.NavigationStarting += guard
    window.native.Invoke(Action(attach))


def main():
    if os.name != 'nt':
        raise RuntimeError('Glitch Desktop currently targets Windows 10/11.')
    import webview
    from glitch.desktop_runtime import install_webview_cleanup_guard
    install_webview_cleanup_guard()
    from glitch.api import DesktopAPI
    from glitch.orchestration import AgentCoordinator
    from glitch.models import ModelClient
    from glitch.storage import Store
    from glitch.discord_bot import DiscordGateway

    directory = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'Glitch'
    store = Store(directory)
    # Environment overrides are optional. They never enter UI responses or conversation history.
    store.import_environment()
    models = ModelClient(store)
    engine = AgentCoordinator(store, models)
    api = DesktopAPI(store, engine, models)
    from glitch.audio import AudioCoordinator
    from glitch.speech_output import SpeechOutputService
    def voice_conversation():
        if not api._voice_session:
            api._voice_session = api.new_conversation()['id']
        return api._voice_session
    api._audio = AudioCoordinator(store.directory, voice_conversation)
    api._speech = SpeechOutputService(api._audio, store.settings,
                                     redactor=store.redact)
    unsubscribe = engine.subscribe_completion(api._speech.on_completed)
    if store.settings()['wake_word_enabled'] and api._audio.models.model_path():
        api._audio.set_wake_enabled(True)
    api._discord = DiscordGateway(store, engine)
    assets = Path(__file__).resolve().parent / 'ui'
    window = webview.create_window('Glitch - Your local agent companion',
                                  url=str(assets / 'index.html'), js_api=api,
                                  width=1380, height=880, min_size=(880, 620), background_color='#101216')
    api._window = window
    window.events.loaded += lambda: install_navigation_guard(window)
    def close():
        unsubscribe()
        api._audio.mute()
        api._speech.close()
        api._audio.close()
        api._discord.stop()
        engine.close()
        models.close()
    window.events.closed += close
    webview.start(gui='edgechromium', private_mode=True, debug=False)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if os.name == 'nt':
            show_startup_error(error)
        else:
            raise
