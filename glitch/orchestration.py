"""Independent bounded agent runs sharing one model and host desktop."""
import json
import os
import threading
import time
import uuid
from contextlib import ExitStack, contextmanager
from glitch.engine import AgentEngine
from glitch.resources import ResourceCoordinator, SHARED_RESOURCES
from glitch.redaction import RUNTIME, event_payload, tool_name

DELEGATION_SCHEMAS = [
    {'name': 'spawn_subagent', 'description': 'Delegate one independent task to a child agent in this workspace. Children cannot delegate.',
     'parameters': {'type': 'object', 'required': ['role', 'task'], 'additionalProperties': False,
                    'properties': {'role': {'type': 'string'}, 'task': {'type': 'string'}}}},
    {'name': 'await_subagent', 'description': 'Wait for a child task and receive its verified final result.',
     'parameters': {'type': 'object', 'required': ['run_id'], 'additionalProperties': False, 'properties': {'run_id': {'type': 'string'}}}},
]


class AgentCoordinator:
    def __init__(self, store, models):
        self.store, self.models = store, models
        self.lock = threading.RLock()
        self.event_lock = threading.RLock()
        self.resources = ResourceCoordinator()
        self.runs = {}
        self.callbacks = []
        self.closed = False
        with store.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, session TEXT, parent_id TEXT, role TEXT, task TEXT, status TEXT, result TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
            if 'dismissed' not in {row['name'] for row in db.execute('PRAGMA table_info(agent_runs)')}:
                db.execute('ALTER TABLE agent_runs ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0')
            db.execute("UPDATE agent_runs SET status='interrupted' WHERE status IN ('running','waiting','needs_approval')")
            self.history = [dict(row) for row in db.execute('SELECT id,session,parent_id,role,task,status,result FROM agent_runs WHERE dismissed=0 ORDER BY rowid DESC LIMIT 40')][::-1]

    def _related_runs(self, sessions=None, identifiers=None):
        with self.store.connect() as db:
            records = {row['id']: dict(row) for row in db.execute('SELECT id,session,parent_id FROM agent_runs')}
        records.update({identifier: run for identifier, run in self.runs.items()})
        related = set(identifiers or ()) | {key for key, run in records.items() if run['session'] in (sessions or ())}
        # Keep both sides of parent/child relationships intact until idle.
        while True:
            expanded = related | {key for key, run in records.items() if run.get('parent_id') in related}
            expanded |= {records[key]['parent_id'] for key in related if key in records and records[key].get('parent_id')}
            if expanded == related:
                return related
            related = expanded

    def _require_runs_idle(self, identifiers):
        for identifier in identifiers:
            run = self.runs.get(identifier)
            if not run:
                continue
            engine = run['engine']
            state = engine.state()
            if state['running_session'] or state.get('approval') or (engine.thread and engine.thread.is_alive()):
                raise ValueError('Stop active tasks and wait for their workers to finish before removing history.')

    @contextmanager
    def _history_admission(self, sessions, workspaces):
        with self.lock, ExitStack() as stack:
            self._require_runs_idle(self._related_runs(sessions))
            # Nonblocking leases prevent standalone tools and new resource
            # acquisitions racing a destructive DB mutation. No human wait here.
            for resources in (self.resources, SHARED_RESOURCES):
                stack.enter_context(resources.guard)
                resources.require_idle(workspaces)
                locks = [resources.desktop] + [resources.workspace_lock(workspace) for workspace in set(workspaces)]
                for lock in locks:
                    if not lock.acquire(blocking=False):
                        raise ValueError('Wait for shared resource operations to finish before removing history.')
                    stack.callback(lock.release)
            yield

    def _forget_sessions(self, sessions):
        # Called only after the transactional mutation succeeds and workers exit.
        self.history = [run for run in self.history if run['session'] not in sessions]
        with self.event_lock:
            self.runs = {key: run for key, run in self.runs.items() if run['session'] not in sessions}

    def delete_session(self, session):
        with self.lock:
            record = self.store.session(session)
            with self._history_admission([session], [record['workspace']]):
                self.store.delete_session(session)
                self._forget_sessions([session])

    def remove_project(self, project):
        with self.lock:
            with self.store.connect() as db:
                registration = db.execute('SELECT workspace FROM projects WHERE id=?', (project,)).fetchone()
                sessions = [row['id'] for row in db.execute('SELECT id FROM sessions WHERE project_id=?', (project,))]
            if not registration:
                raise ValueError('Project does not exist.')
            with self._history_admission(sessions, [registration['workspace']]):
                self.store.remove_project(project)
                self._forget_sessions(sessions)

    def dismiss_run(self, identifier):
        with self.lock:
            self._require_runs_idle(self._related_runs(identifiers=[identifier]))
            with self.store.connect() as db:
                row = db.execute('SELECT status FROM agent_runs WHERE id=?', (identifier,)).fetchone()
                if not row or row['status'] not in ('completed', 'stopped', 'paused', 'interrupted'):
                    raise ValueError('Only finished agent cards can be dismissed.')
                db.execute('UPDATE agent_runs SET dismissed=1 WHERE id=?', (identifier,))
            self.history = [run for run in self.history if run['id'] != identifier]
            if identifier in self.runs:
                self.runs[identifier]['dismissed'] = True

    def active_session(self, session):
        with self.lock:
            return any(r['session'] == session and r['engine'].state()['running_session'] for r in self.runs.values())

    def is_idle(self):
        """Host admission check must not depend on decrypting output descriptors."""
        with self.lock:
            for run in self.runs.values():
                state = run['engine'].state()
                if state['running_session'] or state['approval']:
                    return False
            return True

    def start(self, session, prompt, parent_id=None, role='Assistant'):
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20000:
            raise ValueError('Enter a task of up to 20,000 characters.')
        if not isinstance(role, str) or not role.strip() or len(role) > 80:
            raise ValueError('Use a role of up to 80 characters.')
        with self.lock:
            self.store.session(session)
            if self.closed:
                raise ValueError('Glitch is shutting down.')
            if self.active_session(session):
                raise ValueError('This conversation already has an active task.')
            active = sum(bool(r['engine'].state()['running_session']) for r in self.runs.values())
            if active >= self.store.settings().get('parallel_streams', 1):
                raise ValueError('All agent streams are occupied. Wait or stop an agent first.')
            prompt, role = self.store.redact(prompt), self.store.redact(role)
            identifier = uuid.uuid4().hex
            engine = AgentEngine(self.store, self.models, coordinator=self, run_id=identifier, parent_id=parent_id)
            run = {'id': identifier, 'session': session, 'parent_id': parent_id, 'role': role, 'task': prompt,
                   'status': 'running', 'result': '', 'engine': engine}
            self.runs[identifier] = run
            with self.store.connect() as db:
                db.execute('INSERT INTO agent_runs(id,session,parent_id,role,task,status,result) VALUES(?,?,?,?,?,?,?)',
                           (identifier, session, parent_id, role, prompt, 'running', ''))
            engine.start(session, prompt)
            return identifier

    def state(self):
        with self.lock:
            active = [r for r in self.runs.values() if r['engine'].state()['running_session']]
            approvals = [r['engine'].state()['approval'] for r in self.runs.values() if r['engine'].state()['approval']]
            return self.store.redact({'running_session': active[0]['session'] if active else None, 'approval': approvals[0] if approvals else None,
                    'approvals': approvals, 'stopping': any(r['engine'].state()['stopping'] for r in active),
                    'runs': (self.history + [{k: v for k, v in r.items() if k not in ('engine', 'dismissed')} for r in list(self.runs.values()) if not r.get('dismissed')])[-40:],
                    'active_sessions': [r['session'] for r in active], 'capacity': self.store.settings().get('parallel_streams', 1)}, RUNTIME)

    def stop(self, run_id=None):
        with self.lock:
            targets = [r for r in self.runs.values() if run_id is None or r['id'] == run_id or r['session'] == run_id or r['parent_id'] == run_id]
            for run in targets:
                run['engine'].stop()

    def resolve_approval(self, identifier, approved):
        with self.lock:
            for run in self.runs.values():
                pending = run['engine'].state()['approval']
                if pending and pending['id'] == identifier:
                    run['engine'].resolve_approval(identifier, approved)
                    return True
        raise ValueError('This approval is no longer pending.')

    def subscribe_completion(self, callback):
        with self.lock:
            self.callbacks.append(callback)
        def unsubscribe():
            with self.lock:
                if callback in self.callbacks:
                    self.callbacks.remove(callback)
        return unsubscribe

    def event(self, run_id, kind, title, payload, event_id):
        payload = self.store.redact(payload, event_payload(kind, title))
        title = self.store.redact(title, tool_name if kind in ('tool', 'result', 'error') else None)
        # Engines emit while holding their own approval lock. Never take the
        # admission lock here: state() takes admission -> engine locks.
        with self.event_lock:
            run = self.runs[run_id]
            if kind == 'message':
                run['result'] = payload.get('text', '')
            run['last_action'] = title
            if kind in ('completed', 'stopped', 'paused'):
                run['status'] = kind
            elif kind == 'approval':
                run['status'] = 'needs_approval'
            elif kind not in ('message', 'error'):
                run['status'] = 'running'
            with self.store.connect() as db:
                db.execute('UPDATE agent_runs SET status=?,result=? WHERE id=?', (run['status'], run['result'], run_id))
            callbacks = list(self.callbacks) if kind == 'completed' else []
            event = {'id': event_id, 'parent_id': run['parent_id'], 'text': run['result'], 'session': run['session']}
        for callback in callbacks:
            try:
                callback(event)
            except Exception:
                pass  # Audio/report delivery must not fail an otherwise completed task.

    def delegate(self, parent_id, name, args, cancel):
        parent = self.runs[parent_id]
        if parent['parent_id']:
            raise ValueError('Child agents cannot create or wait for other agents.')
        if name == 'spawn_subagent':
            if set(args) != {'role', 'task'}:
                raise ValueError('Provide a role and task only.')
            workspace = self.store.session(parent['session'])['workspace']
            session = self.store.new_session(workspace)
            identifier = self.start(session, args['task'], parent_id, args['role'])
            return {'ok': True, 'run_id': identifier, 'session': session}
        if set(args) != {'run_id'} or not isinstance(args['run_id'], str):
            raise ValueError('Provide a child run_id.')
        child = self.runs.get(args['run_id'])
        if not child or child['parent_id'] != parent_id:
            raise ValueError('This is not your child agent.')
        deadline = time.monotonic() + 300
        parent['status'] = 'waiting'
        while child['engine'].state()['running_session']:
            if cancel.wait(.1):
                raise InterruptedError('Stopped waiting for the child.')
            if time.monotonic() > deadline:
                return {'ok': False, 'error': 'Child is still working. Check its progress before waiting again.'}
        return {'ok': child['status'] == 'completed', 'status': child['status'], 'result': child['result'][:20000]}

    def close(self):
        self.closed = True
        self.stop()
        for run in list(self.runs.values()):
            if run['engine'].thread:
                run['engine'].thread.join(timeout=5)
