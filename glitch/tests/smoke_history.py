"""Bounded native lifecycle smoke; temporary data, no inference/audio/services."""
import argparse
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch


def run(output, race=False):
    import webview
    from glitch.api import DesktopAPI
    from glitch.desktop_runtime import install_webview_cleanup_guard
    from glitch.models import ModelClient
    from glitch.orchestration import AgentCoordinator
    from glitch.storage import Store

    install_webview_cleanup_guard()
    result = {'passed': False, 'checks': []}
    with patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}), tempfile.TemporaryDirectory(prefix='glitch-history-smoke-') as folder:
        root = Path(folder)
        store = Store(root / 'data')
        project = root / 'project'
        project.mkdir()
        sentinel = project / 'keep.txt'
        sentinel.touch()
        session = store.new_session(project)
        store.message(session, 'assistant', 'Archived reply')
        store.event(session, 'message', 'Reply', {'text': 'Archived reply'})
        models = ModelClient(store)
        coordinator = AgentCoordinator(store, models)
        api = DesktopAPI(store, coordinator, models)
        window = webview.create_window('Glitch - History verification',
            str(Path(__file__).parents[1] / 'ui' / 'index.html'), js_api=api,
            width=1200, height=800, background_color='#101216')
        api._window = window

        def wait(expression):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if window.evaluate_js(expression):
                    return
                time.sleep(.1)
            raise AssertionError('Timed out: ' + expression)

        def probe():
            try:
                wait('state.initialized && state.session!==null')
                if race:
                    wait('!state.polling && !state.initializing')
                    window.evaluate_js((Path(__file__).with_name('history_selection_fixture.js')).read_text(encoding='utf-8'))
                    wait('window.historyRaceDone===true')
                    result.update(window.evaluate_js('window.historyRaceResult'))
                    return
                wait("document.querySelectorAll('#projects .history-row').length===1")
                window.evaluate_js("window.confirm=()=>false;document.getElementById('clear-chat').click()")
                time.sleep(.2)
                assert window.evaluate_js("document.getElementById('messages').textContent.includes('Archived reply')")
                window.evaluate_js("window.confirm=()=>true;document.getElementById('clear-chat').click()")
                wait("!state.historyBusy && !document.getElementById('messages').textContent.includes('Archived reply')")
                assert window.evaluate_js("document.getElementById('events').textContent.includes('Reply')")
                assert len(store.messages(session)) == 1
                result['checks'].append('Confirmed chat clearing hides display only, timeline/archive retained')
                window.evaluate_js("document.getElementById('clear-timeline').click()")
                wait("!state.historyBusy && document.getElementById('event-count').textContent==='0'")
                store.message(session, 'assistant', 'New reply')
                store.event(session, 'message', 'New reply', {'text': 'New reply'})
                wait("document.getElementById('messages').textContent.includes('New reply')")
                result['checks'].append('Timeline clearing and new live message visibility')
                window.evaluate_js("document.querySelector('#sessions .history-remove').click()")
                wait('!state.historyBusy && state.session===null')
                assert sentinel.exists()
                window.evaluate_js("document.querySelector('#projects .history-remove').click()")
                wait("!state.historyBusy && document.getElementById('projects').textContent.includes('No registered projects')")
                assert sentinel.exists()
                result['checks'].append('Conversation deletion, empty fallback and registration removal preserve files')
                window.evaluate_js("document.getElementById('new').click()")
                wait('state.session!==null && state.sessions.length===1')
                result['checks'].append('New conversation after last deletion')
                result['passed'] = True
            except Exception as error:
                result['error'] = str(error)
            finally:
                coordinator.close()
                Path(output).write_text(json.dumps(result, indent=2), encoding='utf-8')
                window.destroy()

        watchdog = threading.Timer(65, window.destroy)
        watchdog.daemon = True
        watchdog.start()
        try:
            webview.start(probe, gui='edgechromium', private_mode=True, debug=False)
        finally:
            watchdog.cancel()
            coordinator.close()
    print(json.dumps(result, indent=2))
    if not result['passed']:
        raise SystemExit(1)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output')
    parser.add_argument('--race', action='store_true')
    args = parser.parse_args()
    run(args.output, race=args.race)
