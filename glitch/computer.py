"""Approved native desktop input and private Chrome control over loopback CDP."""

import base64
import io
import json
import os
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import requests

COMPUTER_SCHEMAS = [
    {'name': 'desktop_screenshot', 'description': 'Capture the primary desktop under the selected action permissions. Returns a PNG for a vision-capable worker.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {}}},
    {'name': 'desktop_input', 'description': 'Approved primary-screen input. Coordinates are native screen pixels from the last screenshot. PyAutoGUI corner fail-safe is enabled.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['action'], 'properties': {
         'action': {'type': 'string', 'enum': ['move', 'click', 'type', 'key', 'hotkey', 'scroll']},
         'x': {'type': 'integer', 'minimum': 0}, 'y': {'type': 'integer', 'minimum': 0},
         'text': {'type': 'string'}, 'key': {'type': 'string'}, 'amount': {'type': 'integer'}}}},
    {'name': 'browser_action', 'description': 'Control isolated Google Chrome. Open HTTP(S) URLs, inspect visible text, capture screenshots, click CSS selectors, fill fields, or read tabs. Uses the selected action permissions.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['action'], 'properties': {
         'action': {'type': 'string', 'enum': ['open', 'text', 'screenshot', 'click', 'fill', 'tabs']},
         'url': {'type': 'string'}, 'selector': {'type': 'string'}, 'text': {'type': 'string'}, 'tab_id': {'type': 'string'}}}},
]


class ChromeController:
    def __init__(self, data_directory, cancel=None):
        self.profile = Path(data_directory) / 'chrome-profile'
        self.base = 'http://127.0.0.1:9222'
        self.cancel = cancel or threading.Event()

    def ensure(self):
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        import psutil
        owned = False
        for process in psutil.process_iter(['name', 'cmdline']):
            try:
                args = process.info['cmdline'] or []
                if (process.info['name'] or '').lower() in ('chrome.exe', 'chrome') and '--remote-debugging-port=9222' in args:
                    if f'--user-data-dir={self.profile}' not in args:
                        raise ValueError('Port 9222 belongs to another Chrome session. Close that debugging session first.')
                    owned = True
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue
        if not owned:
            # A non-HTTP listener is still foreign; an HTTP probe cannot establish
            # that a port is free. Do not launch Chrome over somebody else's port.
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', urlsplit(self.base).port))
                except OSError:
                    raise ValueError('Port 9222 is occupied by an unrelated service.') from None
            candidates = [Path(os.environ.get(name, '')) / suffix for name, suffix in [
                ('PROGRAMFILES', 'Google/Chrome/Application/chrome.exe'),
                ('PROGRAMFILES(X86)', 'Google/Chrome/Application/chrome.exe'),
                ('LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe')]]
            chrome = next((p for p in candidates if p.is_file()), None)
            if chrome is None:
                raise ValueError('Install Google Chrome to enable browser control.')
            # Reject any unrelated service before creating a debugging browser.
            try:
                requests.get(self.base + '/json/version', timeout=1).raise_for_status()
            except requests.RequestException:
                pass
            else:
                raise ValueError('Port 9222 is occupied by an unrelated service.')
            self.profile.mkdir(parents=True, exist_ok=True)
            subprocess.Popen([str(chrome), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222',
                              f'--user-data-dir={self.profile}', '--no-first-run', '--no-default-browser-check', 'about:blank'],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.cancel.is_set():
                raise InterruptedError('Stopped.')
            try:
                response = requests.get(self.base + '/json/list', timeout=1)
                response.raise_for_status()
                pages = [p for p in response.json() if p.get('type') == 'page']
                if pages:
                    return pages
            except requests.RequestException:
                pass
            time.sleep(0.2)
        raise RuntimeError('Chrome did not establish its local debugging session.')

    def action(self, args):
        import websocket
        pages = self.ensure()
        if args['action'] == 'tabs':
            return {'ok': True, 'tabs': [{'id': p['id'], 'title': p['title'], 'url': p['url']} for p in pages]}
        page = next((p for p in pages if p['id'] == args.get('tab_id', pages[0]['id'])), None)
        if page is None:
            raise ValueError('The requested browser tab no longer exists.')
        endpoint = page['webSocketDebuggerUrl']
        parsed = urlsplit(endpoint)
        if parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.port != 9222:
            raise ValueError('Invalid Chrome session endpoint.')
        connection = websocket.create_connection(endpoint, timeout=10, suppress_origin=True, http_proxy_host=None)
        counter = 0
        def call(method, params=None):
            nonlocal counter
            if self.cancel.is_set():
                raise InterruptedError('Stopped.')
            counter += 1
            identifier = counter
            connection.send(json.dumps({'id': identifier, 'method': method, 'params': params or {}}))
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                response = json.loads(connection.recv())
                if response.get('id') == identifier:
                    if 'error' in response:
                        raise RuntimeError(response['error']['message'])
                    return response.get('result', {})
            raise TimeoutError('Chrome did not respond.')
        try:
            action = args['action']
            if action == 'open':
                url = urlsplit(args.get('url', ''))
                if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
                    raise ValueError('Browser navigation accepts HTTP(S) URLs without embedded credentials.')
                result = call('Page.navigate', {'url': args['url']})
                return {'ok': not result.get('errorText'), 'url': args['url'], 'error': result.get('errorText')}
            if action == 'screenshot':
                return {'ok': True, '_image': call('Page.captureScreenshot', {'format': 'png'})['data']}
            if action == 'text':
                expression = 'document.body.innerText.slice(0,18000)'
            else:
                selector = json.dumps(args.get('selector', ''))
                if not args.get('selector'):
                    raise ValueError('Provide a CSS selector.')
                if action == 'click':
                    expression = f'(()=>{{const e=document.querySelector({selector});if(!e)throw Error("Element missing");e.click();return "clicked";}})()'
                elif action == 'fill':
                    value = json.dumps(args.get('text', ''))
                    expression = f'(()=>{{const e=document.querySelector({selector});if(!e||!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))throw Error("Input missing");const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,{value});e.dispatchEvent(new Event("input",{{bubbles:true}}));e.dispatchEvent(new Event("change",{{bubbles:true}}));return "filled";}})()'
                else:
                    raise ValueError('Unsupported browser action.')
            result = call('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
            if result.get('exceptionDetails'):
                raise ValueError('Browser action failed: element missing or inaccessible.')
            return {'ok': True, 'value': result.get('result', {}).get('value')}
        finally:
            connection.close()

    def fill_credential(self, args, origin, resolve):
        """Check the live top frame, then guard and fill in one synchronous JS turn."""
        import websocket
        from glitch.vault import canonical_origin
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        pages = self.ensure()
        page = next((p for p in pages if p['id'] == args['tab_id']), None)
        if page is None:
            raise ValueError('The requested browser tab no longer exists.')
        endpoint = page['webSocketDebuggerUrl']
        parsed = urlsplit(endpoint)
        if (parsed.scheme != 'ws' or parsed.hostname not in ('127.0.0.1', 'localhost') or
                parsed.port != 9222 or parsed.username is not None or parsed.password is not None):
            raise ValueError('Invalid Chrome session endpoint.')
        connection = websocket.create_connection(endpoint, timeout=2, suppress_origin=True, http_proxy_host=None)
        counter = 0

        def call(method, params=None):
            nonlocal counter
            if self.cancel.is_set():
                raise InterruptedError('Stopped.')
            counter += 1
            connection.send(json.dumps({'id': counter, 'method': method, 'params': params or {}}))
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if self.cancel.is_set():
                    raise InterruptedError('Stopped.')
                response = json.loads(connection.recv())
                if response.get('id') == counter:
                    if 'error' in response:
                        raise ValueError('Credential fill failed in Chrome.')
                    return response.get('result', {})
            raise TimeoutError('Chrome did not respond.')

        try:
            frame = call('Page.getFrameTree')['frameTree']['frame']
            actual = urlsplit(frame['url'])
            if canonical_origin(actual.scheme + '://' + actual.netloc) != origin:
                raise ValueError('Credential is not authorized for the current browser origin.')
            payload = resolve()
            # Set both fields before dispatching page handlers. Navigation to another
            # document between CDP calls is stopped by the in-expression origin guard.
            expression = '''(()=>{
                if(location.origin!==ORIGIN)throw Error("Origin changed");
                const u=document.querySelector(USER_SELECTOR),p=document.querySelector(PASS_SELECTOR);
                if(!u||!p||u===p||!(u instanceof HTMLInputElement)||
                   !(p instanceof HTMLInputElement)||p.type!=="password")throw Error("Input missing");
                const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
                set.call(u,USER_VALUE);set.call(p,PASS_VALUE);
                for(const e of [u,p]){e.dispatchEvent(new Event("input",{bubbles:true}));
                                     e.dispatchEvent(new Event("change",{bubbles:true}));}
                return true;
            })()'''
            replacements = {'ORIGIN': origin, 'USER_SELECTOR': args['username_selector'],
                            'PASS_SELECTOR': args['password_selector'],
                            'USER_VALUE': payload['username'], 'PASS_VALUE': payload['password']}
            # Replace markers in one pass; credential text is never parsed as a marker.
            import re
            expression = re.sub(r'ORIGIN|USER_SELECTOR|PASS_SELECTOR|USER_VALUE|PASS_VALUE',
                                lambda match: json.dumps(replacements[match[0]]), expression)
            result = call('Runtime.evaluate', {'expression': expression, 'returnByValue': True})
            if self.cancel.is_set():
                raise InterruptedError('Stopped.')
            if result.get('exceptionDetails') or result.get('result', {}).get('value') is not True:
                raise ValueError('Credential fill failed: origin changed or inputs inaccessible.')
            return {'ok': True, 'fields': ['username', 'password']}
        finally:
            connection.close()


class ComputerTools:
    def __init__(self, directory, approve, emit, cancel):
        self.directory, self.approve, self.emit, self.cancel = Path(directory), approve, emit, cancel
        self.chrome = ChromeController(directory, cancel)

    def execute(self, name, args):
        schema = next((t['parameters'] for t in COMPUTER_SCHEMAS if t['name'] == name), None)
        if schema is None or not isinstance(args, dict) or set(args) - set(schema['properties']):
            raise ValueError('Invalid computer tool arguments.')
        if any(k not in args for k in schema.get('required', [])):
            raise ValueError('Missing computer action.')
        for key, value in args.items():
            kind = schema['properties'][key]['type']
            if (kind == 'string' and not isinstance(value, str)) or (kind == 'integer' and type(value) is not int):
                raise ValueError('Invalid input types.')
            options = schema['properties'][key].get('enum')
            if options and value not in options:
                raise ValueError('Unsupported computer action.')
            if isinstance(value, str) and len(value) > 10000:
                raise ValueError('Computer inputs must be shorter than 10,000 characters.')
        if not self.approve(name.replace('_', ' ').title(), args | {'notice': 'Desktop input controls the currently focused app. Screenshots may contain private information; remote tasks send approved captures to Discord.'}):
            return {'ok': False, 'denied': True, 'error': 'User denied computer action. Revise the plan.'}
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        if name == 'browser_action':
            self.emit('browser', 'Glitch is operating the browser', {'action': args['action']})
            result = self.chrome.action(args)
        else:
            import pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.15
            if name == 'desktop_screenshot':
                image = pyautogui.screenshot()
                output = io.BytesIO()
                image.save(output, format='PNG')
                result = {'ok': True, '_image': base64.b64encode(output.getvalue()).decode(),
                          'width': image.width, 'height': image.height}
            else:
                self.emit('computer', 'Glitch is navigating the desktop', {'action': args['action']})
                action = args['action']
                if action in ('move', 'click'):
                    x, y = args.get('x', -1), args.get('y', -1)
                    if not pyautogui.onScreen(x, y):
                        raise ValueError('Coordinates are outside the primary screen.')
                    pyautogui.moveTo(x, y, duration=0.2)
                    if action == 'click':
                        if self.cancel.is_set():
                            raise InterruptedError('Stopped.')
                        pyautogui.click()
                elif action == 'type':
                    text = args.get('text', '')
                    if text.isascii():
                        for character in text:
                            if self.cancel.is_set():
                                raise InterruptedError('Stopped.')
                            pyautogui.write(character, _pause=False)
                            time.sleep(0.015)
                    else:
                        import pyperclip
                        previous = pyperclip.paste()
                        try:
                            pyperclip.copy(text)
                            if self.cancel.is_set():
                                raise InterruptedError('Stopped.')
                            pyautogui.hotkey('ctrl', 'v')
                            time.sleep(0.2)
                        finally:
                            if pyperclip.paste() == text:
                                pyperclip.copy(previous)
                elif action == 'key':
                    key = args.get('key', '')
                    if key not in pyautogui.KEYBOARD_KEYS:
                        raise ValueError('Unknown keyboard key.')
                    pyautogui.press(key)
                elif action == 'hotkey':
                    keys = args.get('key', '').lower().split('+')
                    if not 1 <= len(keys) <= 4 or any(key not in pyautogui.KEYBOARD_KEYS for key in keys):
                        raise ValueError('Use up to four valid keys, e.g. ctrl+shift+s.')
                    pyautogui.hotkey(*keys)
                elif action == 'scroll':
                    amount = args.get('amount', 0)
                    if abs(amount) > 30:
                        raise ValueError('Scroll amount must be between -30 and 30.')
                    pyautogui.scroll(amount)
                result = {'ok': True}
        if '_image' in result:
            folder = self.directory / 'captures'
            folder.mkdir(exist_ok=True)
            path = folder / (str(uuid.uuid4()) + '.png')
            path.write_bytes(base64.b64decode(result['_image'], validate=True))
            result['capture'] = str(path)
        return result
