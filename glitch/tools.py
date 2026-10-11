"""Workspace-scoped tools with approval before every mutation or command."""

import difflib
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

RECIPES = {
    'git_status': ['git', 'status', '--short'],
    'git_diff': ['git', '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--', '.'],
    'git_log': ['git', '--no-pager', 'log', '-5', '--oneline'],
    'python_tests': ['py', '-3', '-m', 'unittest', 'discover', '-v'] if os.name == 'nt' else [sys.executable, '-m', 'unittest', 'discover', '-v'],
    'dotnet_build': ['dotnet', 'build', '--no-restore'],
    'list_directory': ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
                       "Get-ChildItem -LiteralPath '.' | Select-Object Mode,Length,Name | Format-Table -AutoSize"] if os.name == 'nt' else ['ls', '-la'],
}

TOOL_SCHEMAS = [
    {'name': 'list_workspace', 'description': 'List one project directory. Expand directories with further calls.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {'directory': {'type': 'string'}}}},
    {'name': 'read_file', 'description': 'Read a project UTF-8 text file; credentials and .git are protected.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['path'], 'properties': {'path': {'type': 'string'}}}},
    {'name': 'write_file', 'description': 'Create or replace a project text file after the user approves the exact diff.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['path', 'content'],
                    'properties': {'path': {'type': 'string'}, 'content': {'type': 'string'}}}},
    {'name': 'run_command', 'description': 'Run a fixed command recipe after approval. Project tests/builds may execute project code.',
     'parameters': {'type': 'object', 'additionalProperties': False, 'required': ['recipe'],
                    'properties': {'recipe': {'type': 'string', 'enum': list(RECIPES)}}}},
]


class WorkspaceTools:
    def __init__(self, workspace, approve, emit, cancel):
        self.root = Path(workspace).resolve(strict=True)
        self.approve = approve
        self.emit = emit
        self.cancel = cancel

    def resolve(self, target):
        if not isinstance(target, str) or not target or '\x00' in target or ':' in target:
            raise ValueError('Use a relative project path.')
        path = (self.root / target).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError('This path is outside the selected project.')
        for part in path.relative_to(self.root).parts:
            lowered = part.lower()
            if lowered in {'.git', '.ssh', '.aws', '.azure', '.glitch', 'credentials.json', 'glitch.sqlite3', 'glitch.sqlite3-wal', 'glitch.sqlite3-shm'} or lowered.startswith('.env') or lowered.endswith(('.pem', '.key', '.dpapi')):
                raise ValueError('Credential and repository metadata files are protected.')
        return path

    def execute(self, name, args):
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        schema = next((t['parameters'] for t in TOOL_SCHEMAS if t['name'] == name), None)
        if schema is None:
            raise ValueError('Unknown tool. Use an available tool name.')
        if not isinstance(args, dict) or set(args) - set(schema['properties']):
            raise ValueError('Unexpected tool arguments.')
        if any(k not in args for k in schema.get('required', [])) or any(not isinstance(v, str) for v in args.values()):
            raise ValueError('Missing or invalid string arguments.')
        if name == 'list_workspace':
            directory = self.resolve(args.get('directory', '.'))
            rows = []
            for child in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                if child.name in {'.git', 'node_modules', '.venv', '__pycache__'}:
                    continue
                try:
                    self.resolve(str(child.relative_to(self.root)))
                except ValueError:
                    continue
                rows.append({'name': child.name, 'type': 'directory' if child.is_dir() else 'file'})
                if len(rows) == 200:
                    break
            return {'ok': True, 'entries': rows}
        if name == 'read_file':
            path = self.resolve(args['path'])
            with path.open('rb') as source:
                data = source.read(120001)
            return {'ok': True, 'path': args['path'], 'content': data[:120000].decode('utf-8'), 'truncated': len(data) > 120000}
        if name == 'write_file':
            return self.write(args)
        return self.command(args['recipe'])

    def write(self, args):
        path = self.resolve(args['path'])
        if path == self.root or len(args['content'].encode('utf-8')) > 1_000_000:
            raise ValueError('Choose a file path; each edit may contain at most 1 MB of text.')
        before = path.read_text(encoding='utf-8') if path.exists() else ''
        diff = ''.join(difflib.unified_diff(before.splitlines(True), args['content'].splitlines(True),
                                          fromfile=args['path'], tofile=args['path']))
        if not self.approve('Write file', {'path': args['path'], 'diff': diff[:60000]}):
            return {'ok': False, 'denied': True, 'error': 'User denied this write. Revise the plan.'}
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        self.resolve(args['path'])
        if (path.read_text(encoding='utf-8') if path.exists() else '') != before:
            raise ValueError('The file changed while approval was pending. Read it again before editing.')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=path.parent, delete=False) as output:
                temporary = Path(output.name)
                output.write(args['content'])
            self.resolve(args['path'])
            if path.exists():
                shutil.copymode(path, temporary)
            temporary.replace(path)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        return {'ok': True, 'path': args['path'], 'bytes': len(args['content'].encode()), 'diff': diff[:60000]}

    def command(self, recipe):
        if recipe not in RECIPES:
            raise ValueError('Unknown command recipe. Arbitrary shell scripts are not accepted.')
        argv = RECIPES[recipe]
        if not self.approve('Run command', {'command': subprocess.list2cmdline(argv), 'workspace': str(self.root),
                                          'note': 'Tests and builds can execute code from this project.'}):
            return {'ok': False, 'denied': True, 'error': 'User denied this command. Revise the plan.'}
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        environment = {k: v for k, v in os.environ.items() if not any(
            word in k.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'API_KEY'))}
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        process = subprocess.Popen(argv, cwd=self.root, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   shell=False, env=environment, creationflags=flags)
        lines = queue.Queue(maxsize=1000)
        def reader():
            try:
                while True:
                    line = process.stdout.readline(4096)
                    if not line:
                        break
                    try:
                        lines.put(line.decode('utf-8', errors='replace'), timeout=1)
                    except queue.Full:
                        continue
            finally:
                process.stdout.close()
        thread = threading.Thread(target=reader, daemon=True)
        thread.start()
        collected, total, timed_out = [], 0, False
        deadline = time.monotonic() + 120
        try:
            while process.poll() is None or thread.is_alive() or not lines.empty():
                if self.cancel.is_set() or time.monotonic() >= deadline:
                    timed_out = not self.cancel.is_set()
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                       capture_output=True, creationflags=flags, timeout=10)
                    else:
                        process.kill()
                    break
                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    continue
                if total < 120000:
                    collected.append(line)
                    total += len(line)
                    self.emit('output', 'Command output', {'text': line})
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
            thread.join(timeout=2)
        if self.cancel.is_set():
            raise InterruptedError('Stopped.')
        return {'ok': process.returncode == 0 and not timed_out, 'exit_code': process.returncode,
                'output': ''.join(collected), 'timed_out': timed_out, 'truncated': total >= 120000}
