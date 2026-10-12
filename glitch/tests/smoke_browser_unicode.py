"""Tiny native JS regression: synthetic DOM only, no Chrome/model/app startup."""
import argparse
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch


def run(output_directory):
    import webview
    from glitch.computer import ChromeController
    from glitch.desktop_runtime import install_webview_cleanup_guard
    from glitch.redaction import RESULT
    from glitch.storage import Store
    from glitch.tests.test_vault import fixture_cipher
    from glitch.vault import Vault

    install_webview_cleanup_guard()
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'real_native_javascript': True, 'checks': []}
    with tempfile.TemporaryDirectory(prefix='glitch-unicode-js-') as folder, \
            patch.dict(os.environ, {'CLOUD_SUPERVISOR_API_KEY': '', 'DISCORD_TOKEN': ''}):
        store = Store(Path(folder) / 'data')
        vault = Vault(store, cipher=fixture_cipher)
        secrets = ['fixture-private-value-7F9Q2Z', 'fixture-private-\U0001f600-value-7F9Q2Z']
        for index, secret in enumerate(secrets):
            vault.save('Synthetic ' + str(index), 'bearer', 'https://example.invalid', {'token': secret})
        controller = ChromeController(folder, vault=vault)
        window = webview.create_window('Glitch - Synthetic Unicode JS boundary', html='<html><body></body></html>',
                                       width=480, height=240)

        def probe():
            try:
                cases = [('non-BMP before ASCII credential', secrets[0], '\U0001f600' * 9010),
                         ('non-BMP before and inside credential', secrets[1], '\U0001f600' * 9010),
                         ('complete Unicode credential control', secrets[1], '\U0001f600' * 9000),
                         ('bounded long DOM with Unicode credential', secrets[1], 'a' * 17990)]
                for name, secret, prefix in cases:
                    source = prefix + secret + 'tail' * 10000
                    wire = Mock()
                    observed = {}
                    def send(message):
                        request = json.loads(message)
                        expression = request['params']['expression']
                        value = window.evaluate_js('(()=>{document.body.textContent=' + json.dumps(source) +
                                                   ';return (' + expression + ');})()')
                        observed['value'] = value
                        wire.recv.return_value = json.dumps({'id': request['id'],
                            'result': {'result': {'value': value}}})
                    wire.send.side_effect = send
                    pages = [{'id': 'synthetic', 'webSocketDebuggerUrl': 'ws://127.0.0.1:9222/devtools/page/synthetic'}]
                    with patch.object(controller, 'ensure', return_value=pages), \
                            patch('websocket.create_connection', return_value=wire):
                        actual = vault.redact(controller.action({'action': 'text'}), RESULT)['value']
                    safe = secret[:8] not in actual
                    raw = observed['value']
                    raw_text = raw['text'] if isinstance(raw, dict) else raw
                    bounded = len(raw_text) <= 18001 + vault.text_stream().carry and len(actual) <= 18000
                    control = not name.startswith('complete') or '[credential removed]' in actual
                    result['checks'].append({'case': name, 'prefix_absent': safe, 'bounded': bounded,
                                             'complete_control_masked': control,
                                             'raw_codepoints': len(raw_text), 'preview_codepoints': len(actual)})
                result['passed'] = all(check['prefix_absent'] and check['bounded'] and
                                       check['complete_control_masked'] for check in result['checks'])
            except Exception as error:
                result['error'] = str(error)
            finally:
                (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
                window.destroy()

        webview.start(probe, gui='edgechromium', private_mode=True, debug=False)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output_directory')
    result = run(parser.parse_args().output_directory)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
