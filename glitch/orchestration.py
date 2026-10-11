"""Independent bounded agent runs sharing one model and host desktop."""
import json
import threading
import time
import uuid
from glitch.engine import AgentEngine
from glitch.resources import ResourceCoordinator

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
            db.execute("UPDATE agent_runs SET status='interrupted' WHERE status IN ('running','waiting','needs_approval')")
            self.history = [dict(row) for row in db.execute('SELECT id,session,parent_id,role,task,status,result FROM agent_runs ORDER BY rowid DESC LIMIT 40')][::-1]

    def active_session(self, session):
        with self.lock:
            return any(r['session'] == session and r['engine'].state()['running_session'] for r in self.runs.values())

    def start(self, session, prompt, parent_id=None, role='Assistant'):
        self.store.session(session)
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20000:
            raise ValueError('Enter a task of up to 20,000 characters.')
        if not isinstance(role, str) or not role.strip() or len(role) > 80:
            raise ValueError('Use a role of up to 80 characters.')
        with self.lock:
            if self.closed:
                raise ValueError('Glitch is shutting down.')
            if self.active_session(session):
                raise ValueError('This conversation already has an active task.')
            active = sum(bool(r['engine'].state()['running_session']) for r in self.runs.values())
            if active >= self.store.settings().get('parallel_streams', 1):
                raise ValueError('All agent streams are occupied. Wait or stop an agent first.')
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
            approvals = [r['engine'].state()['approval'] for r in active if r['engine'].state()['approval']]
            return {'running_session': active[0]['session'] if active else None, 'approval': approvals[0] if approvals else None,
                    'approvals': approvals, 'stopping': any(r['engine'].state()['stopping'] for r in active),
                    'runs': (self.history + [{k: v for k, v in r.items() if k != 'engine'} for r in list(self.runs.values())])[-40:],
                    'active_sessions': [r['session'] for r in active], 'capacity': self.store.settings().get('parallel_streams', 1)}

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
