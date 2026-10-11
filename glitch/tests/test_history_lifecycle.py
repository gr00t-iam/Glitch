import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path

from glitch.storage import Store
from glitch.api import DesktopAPI
from glitch.orchestration import AgentCoordinator


class HistoryLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = Store(self.root / 'data')
        self.session = self.store.new_session(self.root)
        self.coordinator = AgentCoordinator(self.store, None)
        self.addCleanup(self.coordinator.close)
        self.api = DesktopAPI(self.store, self.coordinator, None)

    def test_legacy_migration_groups_canonical_workspace(self):
        directory = self.root / 'legacy'
        directory.mkdir()
        with sqlite3.connect(directory / 'glitch.sqlite3') as db:
            db.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT)')
            db.executemany('INSERT INTO sessions VALUES(?,?,?,?)', [('a', str(self.root), 'A', '2020'), ('b', str(self.root / '.'), 'B', '2021')])
        db.close()
        migrated = Store(directory)
        self.assertEqual(len(migrated.projects()), 1)
        self.assertEqual(migrated.session('a')['project_id'], migrated.session('b')['project_id'])
        self.assertEqual(Store(directory).projects(), migrated.projects())

    def test_project_removal_preserves_files_and_vault(self):
        second = self.store.new_session(self.root)
        keep = self.root / 'keep.txt'
        keep.touch()
        self.store.vault.save('V', 'bearer', 'https://example.com', {'token': 'test-lifecycle-secret'})
        project = self.store.session(second)['project_id']
        self.store.remove_project(project)
        self.assertEqual(self.store.sessions(), [])
        self.assertEqual(self.store.projects(), [])
        self.assertTrue(keep.exists())
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM vault').fetchone()[0], 1)

    def test_delete_transaction_rolls_back_all_records(self):
        self.store.message(self.session, 'user', 'keep')
        self.store.anchor(self.session, 'keep')
        self.store.event(self.session, 'started', 'keep')
        with self.store.connect() as db:
            db.execute("CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'blocked'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.delete_session(self.session)
        self.assertEqual(len(self.store.messages(self.session)), 1)
        self.assertEqual(len(self.store.anchors(self.session)), 1)
        self.assertEqual(len(self.store.events(self.session, 0)), 1)

    def test_watermarks_restart_archive_and_new_visibility(self):
        self.store.message(self.session, 'assistant', 'old')
        old = self.store.event(self.session, 'message', 'old', {'text': 'old'})
        self.api.clear_view(self.session, 'chat')
        self.assertEqual(self.api.load_conversation(self.session)['messages'], [])
        self.assertEqual(len(self.api.load_conversation(self.session)['events']), 1)
        self.api.clear_view(self.session, 'timeline')
        restarted = Store(self.store.directory)
        api = DesktopAPI(restarted, self.coordinator, None)
        self.assertEqual(api.poll(self.session, 0)['events'], [])
        restarted.message(self.session, 'assistant', 'new')
        new = restarted.event(self.session, 'message', 'new', {'text': 'new'})
        self.assertGreater(new, old)
        self.assertEqual([m['content'] for m in api.load_conversation(self.session)['messages']], ['new'])
        self.assertEqual(len(restarted.messages(self.session)), 2)
        self.assertEqual([e['id'] for e in api.poll(self.session, 0)['events']], [new])

    def test_ids_not_reused_after_delete(self):
        self.store.message(self.session, 'user', 'first')
        message = self.store.messages(self.session)[0]['id']
        event = self.store.event(self.session, 'started', 'first')
        self.store.delete_session(self.session)
        session = self.store.new_session(self.root)
        self.store.message(session, 'user', 'next')
        self.assertGreater(self.store.messages(session)[0]['id'], message)
        self.assertGreater(self.store.event(session, 'started', 'next'), event)

    def test_last_delete_fallback_and_missing_directory(self):
        folder = self.root / 'missing'
        folder.mkdir()
        missing = self.store.new_session(folder)
        folder.rmdir()
        self.assertEqual(self.api.load_conversation(missing)['messages'], [])
        fallback = self.api.new_conversation(missing)
        self.assertNotEqual(fallback['workspace'], str(folder))
        for session in list(self.store.sessions()):
            result = self.api.delete_session(session['id'])
        self.assertIsNone(result['session'])
        self.assertTrue(Path(self.api.new_conversation()['workspace']).is_dir())

    def test_child_pending_thread_and_sibling_guards(self):
        sibling = self.store.new_session(self.root)
        class Engine:
            thread = None
            def state(self):
                return {'running_session': None, 'approval': {'id': 'pending'}, 'stopping': False}
            def stop(self):
                pass
        run = {'id': 'child', 'session': sibling, 'parent_id': 'parent', 'engine': Engine(), 'status': 'completed'}
        self.coordinator.runs['child'] = run
        with self.store.connect() as db:
            db.execute("INSERT INTO agent_runs(id,session,status) VALUES('parent',?,'completed')", (self.session,))
        with self.assertRaises(ValueError):
            self.api.delete_session(self.session)
        with self.assertRaises(ValueError):
            self.api.remove_project(self.store.session(self.session)['project_id'])
        self.api.clear_view(sibling, 'timeline')
        self.assertEqual(self.coordinator.runs['child']['engine'].state()['approval']['id'], 'pending')
        self.coordinator.runs.clear()
        self.api.delete_session(self.session)
        self.assertEqual(self.store.session(sibling)['id'], sibling)

    def test_resource_lease_blocks_delete(self):
        with self.coordinator.resources.lease('Write file', self.root, threading.Event()):
            with self.assertRaises(ValueError):
                self.api.delete_session(self.session)
        self.api.delete_session(self.session)

    def test_dismiss_completed_keeps_history_rejects_active(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO agent_runs(id,session,status) VALUES('done',?,'completed')", (self.session,))
        coordinator = AgentCoordinator(self.store, None)
        coordinator.dismiss_run('done')
        self.assertEqual(coordinator.state()['runs'], [])
        self.assertEqual(AgentCoordinator(self.store, None).state()['runs'], [])
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM agent_runs WHERE id='done'").fetchone()[0], 1)

    def test_worker_exit_required_for_delete_and_dismiss(self):
        finish = threading.Event()
        class Engine:
            def __init__(self):
                self.thread = threading.Thread(target=finish.wait)
                self.thread.start()
            def state(self):
                return {'running_session': None, 'approval': None, 'stopping': False}
            def stop(self):
                finish.set()
        engine = Engine()
        self.addCleanup(engine.thread.join, 2)
        self.addCleanup(finish.set)
        self.coordinator.runs['done'] = {'id': 'done', 'session': self.session, 'parent_id': None,
                                         'engine': engine, 'status': 'completed'}
        with self.store.connect() as db:
            db.execute("INSERT INTO agent_runs(id,session,status) VALUES('done',?,'completed')", (self.session,))
        with self.assertRaises(ValueError):
            self.api.dismiss_run('done')
        with self.assertRaises(ValueError):
            self.api.delete_session(self.session)
        finish.set()
        engine.thread.join(2)
        self.api.dismiss_run('done')
        self.assertIn('done', self.coordinator.runs)
        self.assertEqual(self.coordinator.state()['runs'], [])
        self.api.delete_session(self.session)

    def test_opaque_ids_and_free_text_redaction(self):
        identifier = self.store.session(self.session)['project_id']
        self.store.vault.save('collision', 'bearer', 'https://example.com', {'token': identifier})
        self.assertEqual(self.api.projects()[0]['id'], identifier)
        self.assertEqual(self.api.bootstrap()['sessions'][0]['project_id'], identifier)
        self.store.message(self.session, 'user', identifier)
        self.assertNotIn(identifier, self.api.load_conversation(self.session)['messages'][0]['content'])

    def test_ui_lifecycle_controls_are_wired(self):
        ui = Path(__file__).parents[1] / 'ui'
        html = (ui / 'index.html').read_text(encoding='utf-8')
        js = (ui / 'app.js').read_text(encoding='utf-8')
        for identifier in ('projects', 'clear-chat', 'clear-timeline'):
            self.assertIn(f'id="{identifier}"', html)
        for method in ('delete_session', 'remove_project', 'clear_view', 'dismiss_run'):
            self.assertIn(f"call('{method}'", js)
        self.assertIn('chatEventWatermark', js)
        self.assertIn('viewGeneration', js)

    def test_transaction_deletes_checkpoints_and_runs_only_for_target(self):
        sibling = self.store.new_session(self.root)
        with self.store.connect() as db:
            db.execute('CREATE TABLE checkpoints(id INTEGER PRIMARY KEY, session TEXT, summary TEXT)')
            for session in (self.session, sibling):
                db.execute('INSERT INTO checkpoints(session,summary) VALUES(?,?)', (session, 'fixture'))
                db.execute('INSERT INTO agent_runs(id,session,status) VALUES(?,?,?)', (session, session, 'completed'))
        self.api.delete_session(self.session)
        with self.store.connect() as db:
            self.assertEqual([r['session'] for r in db.execute('SELECT session FROM checkpoints')], [sibling])
            self.assertEqual([r['session'] for r in db.execute('SELECT session FROM agent_runs')], [sibling])

    def test_unrelated_active_workspace_does_not_block_inactive_delete(self):
        folder = self.root / 'other'
        folder.mkdir()
        session = self.store.new_session(folder)
        class Engine:
            thread = None
            def state(self):
                return {'running_session': session, 'approval': None, 'stopping': False}
            def stop(self):
                pass
        self.coordinator.runs['other'] = {'id': 'other', 'session': session, 'parent_id': None, 'engine': Engine()}
        self.api.delete_session(self.session)
        with self.assertRaises(ValueError):
            self.api.delete_session(session)

    def test_clear_validation_and_other_session_independence(self):
        sibling = self.store.new_session(self.root)
        self.store.message(sibling, 'user', 'visible')
        with self.assertRaises(ValueError):
            self.api.clear_view(self.session, 'all')
        self.api.clear_view(self.session, 'chat')
        self.assertEqual(len(self.api.load_conversation(sibling)['messages']), 1)

    def test_late_message_event_cannot_reveal_cleared_archive(self):
        self.store.message(self.session, 'assistant', 'before clear')
        self.api.clear_view(self.session, 'chat')
        self.store.event(self.session, 'message', 'Delayed delivery', {'text': 'before clear'})
        event = self.api.poll(self.session, 0)['events'][0]
        self.assertFalse(event.get('chat_visible', True))
        self.store.message(self.session, 'assistant', 'after clear')
        self.store.event(self.session, 'message', 'New delivery', {'text': 'after clear'})
        self.assertTrue(self.api.poll(self.session, event['id'])['events'][0]['chat_visible'])


if __name__ == '__main__':
    unittest.main()
