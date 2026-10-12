"""Focused Task 6 review regressions. Temporary stores/repos and synthetic HTTPS only."""
import threading
import copy
import tempfile
import inspect
from pathlib import Path
import unittest
from unittest.mock import patch
from unittest.mock import Mock

from dulwich.repo import Repo
from glitch.tests import test_github_tools as fixtures
from glitch.resources import ResourceCoordinator, workspace_identity
from glitch.engine import AgentEngine
from glitch.storage import Store


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.fx = fixtures.PublishingTests()
        self.fx.setUp()
        self.addCleanup(self.fx.doCleanups)

    def test_host_refusals_preserve_staged_author_and_changed_review_diagnostics(self):
        fx = self.fx
        fx.branch()
        fx.edit()
        with Repo(fx.workspace) as repo:
            repo.get_worktree().stage(['hello.txt'])
        with self.assertRaisesRegex(ValueError, 'Preexisting staged changes are ambiguous'):
            fx.publish()
        with Repo(fx.workspace) as repo:
            fx.edit(data=b'hello\n')
            repo.get_worktree().stage(['hello.txt'])
        fx.edit()
        fx.store.save_settings({'github_author_name': '', 'github_author_email': ''})
        with self.assertRaisesRegex(ValueError, 'Save the GitHub author'):
            fx.publish()
        fx.store.save_settings({'github_author_name': 'Fixture', 'github_author_email': 'fixture@example.invalid'})
        def changed(*args):
            fx.edit(data=b'changed after review\n')
            return True
        fx.approve.side_effect = changed
        with self.assertRaisesRegex(ValueError, 'HEAD, index or file bytes changed'):
            fx.publish()

    def test_parser_and_transport_strings_cannot_claim_host_diagnostic_trust(self):
        fx = self.fx
        secret = fixtures.fixtures.SYNTHETIC
        with patch.object(fx.service, '_fingerprint', side_effect=ValueError('Parser echoed ' + secret)):
            with self.assertRaises(ValueError) as error:
                fx.service.prepare(fx.workspace, 'github_create_branch', {'branch': 'feature/x'}, fx.cancel)
        self.assertNotIn(secret, str(error.exception))
        self.assertIn('Repository inspection failed', str(error.exception))
        fx.http.side_effect = ValueError('GitHub untrusted transport ' + secret)
        with self.assertRaises(ValueError) as error:
            fx.service._get('/user', {'token': secret}, fx.cancel, float('inf'))
        self.assertNotIn(secret, str(error.exception))
        self.assertNotIn('untrusted transport', str(error.exception))

    def ready_pr(self):
        fx = self.fx
        fx.branch()
        fx.edit()
        self.head = fx.publish()['head']
        with Repo(fx.remote) as repo:
            self.base = repo.refs[b'refs/heads/main'].decode()
        self.args = {'head': 'feature/work', 'base': 'main', 'title': 'Reviewed PR', 'body': ''}
        self.lookups = 0
        self.lookup_hook = None
        self.post_hook = None
        self.lost_response = True
        self.post_data = None
        self.default_branch = 'main'
        fx.http.side_effect = self.pr_route

    def pr_item(self, number=7, state='open', head=None):
        return {'id': number * 100, 'number': number, 'state': state, 'merged': False,
                'html_url': f'https://github.com/fixture/sample/pull/{number}',
                'head': {'ref': 'feature/work', 'sha': head or self.head, 'repo': {'full_name': 'fixture/sample'}},
                'base': {'ref': 'main', 'sha': self.base, 'repo': {'full_name': 'fixture/sample'}}}

    def pr_route(self, endpoint, payload, cancel, deadline, body=None):
        fx = self.fx
        if '/pulls?' in endpoint:
            self.lookups += 1
            if self.lookup_hook:
                self.lookup_hook()
            return 200, {}, [copy.deepcopy(fx.pull)] if fx.pull else []
        if endpoint.endswith('/pulls') and body:
            fx.posts += 1
            fx.pull = self.pr_item()
            if self.post_hook:
                self.post_hook()
            if self.lost_response:
                raise OSError('GitHub untrusted lost response ' + fixtures.fixtures.SYNTHETIC)
            return 201, {}, self.post_data or copy.deepcopy(fx.pull)
        if endpoint == '/repos/fixture/sample':
            return 200, {}, fixtures.backend.GitHubTests.repository() | {'default_branch': self.default_branch}
        return fx.response(endpoint, payload, cancel, deadline, body)

    def create_pr(self):
        return self.fx.tools.execute('github_create_pull_request', self.args)

    def test_pr_search_cannot_change_approved_remote_state_then_post(self):
        self.ready_pr()
        def changed():
            self.fx.advance_remote(b'changed in PR lookup\n')
            self.fx.protected = True
        self.lookup_hook = changed
        with self.assertRaisesRegex(ValueError, 'Remote refs changed'):
            self.create_pr()
        self.assertEqual(self.fx.posts, 0)

    def test_pr_pre_post_rechecks_base_protection_binding_and_local_bytes(self):
        self.ready_pr()
        fx = self.fx
        for change in ('base', 'protection', 'binding', 'local'):
            with self.subTest(change=change):
                def changed():
                    if change == 'base':
                        with Repo(fx.remote) as repo:
                            repo.refs[b'refs/heads/main'] = self.head.encode()
                    elif change == 'protection':
                        fx.protected = True
                    elif change == 'binding':
                        with fx.store.connect() as db:
                            db.execute("UPDATE github_connections SET default_branch='other'")
                    else:
                        fx.edit(data=b'local race\n')
                self.lookup_hook = changed
                with self.assertRaises(ValueError):
                    self.create_pr()
                self.assertEqual(fx.posts, 0)
                self.lookup_hook = None
                fx.protected = False
                fx.edit()
                with Repo(fx.remote) as repo:
                    repo.refs[b'refs/heads/main'] = self.base.encode()
                with fx.store.connect() as db:
                    db.execute("UPDATE github_connections SET default_branch='main'")

    def test_uncertain_pr_lookup_cannot_reuse_result_after_protection_change(self):
        self.ready_pr()
        self.lookup_hook = lambda: setattr(self.fx, 'protected', True) if self.fx.posts else None
        result = self.create_pr()
        self.assertFalse(result['ok'])
        self.assertTrue(result['uncertain_creation'])
        self.assertEqual(self.fx.posts, 1)
        self.assertNotIn(fixtures.fixtures.SYNTHETIC, str(result))

    def test_closed_stale_pr_is_not_success_for_current_work(self):
        self.ready_pr()
        self.fx.pull = self.pr_item(8, state='closed', head='a' * 40)
        result = self.create_pr()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['number'], 7)
        self.assertEqual(self.fx.posts, 1)

    def test_only_exact_current_open_pr_can_be_reused(self):
        self.ready_pr()
        self.fx.pull = self.pr_item(8, head='a' * 40)
        with self.assertRaisesRegex(ValueError, 'stale'):
            self.create_pr()
        self.assertEqual(self.fx.posts, 0)
        self.fx.pull = self.pr_item(9)
        result = self.create_pr()
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['number'], 9)
        self.assertEqual(self.fx.posts, 0)

    def test_noncanonical_or_foreign_pr_lookup_is_refused_without_post(self):
        self.ready_pr()
        for change in ('url', 'repo', 'id'):
            with self.subTest(change=change):
                self.fx.pull = self.pr_item()
                if change == 'url':
                    self.fx.pull['html_url'] = 'https://evil.invalid/pull/7'
                elif change == 'repo':
                    self.fx.pull['base']['repo']['full_name'] = 'other/sample'
                else:
                    self.fx.pull['id'] = True
                with self.assertRaises(ValueError):
                    self.create_pr()
                self.assertEqual(self.fx.posts, 0)

    def test_pr_response_race_and_terminal_response_report_uncertainty(self):
        self.ready_pr()
        self.lost_response = False
        self.post_data = self.pr_item(state='closed')
        self.post_hook = lambda: setattr(self.fx, 'pull', self.pr_item(state='closed'))
        result = self.create_pr()
        self.assertFalse(result['ok'])
        self.assertTrue(result['uncertain_creation'])
        self.assertEqual(self.fx.posts, 1)

    def test_known_post_identity_cannot_reconcile_to_a_different_pr(self):
        self.ready_pr()
        self.lost_response = False
        self.post_data = self.pr_item(10, head='a' * 40)
        result = self.create_pr()
        self.assertFalse(result['ok'])
        self.assertTrue(result['uncertain_creation'])
        self.assertEqual(self.fx.posts, 1)

    def test_uncertain_lookup_rechecks_head_base_default_binding_index_and_local_bytes(self):
        self.ready_pr()
        fx = self.fx
        for change in ('head', 'base', 'default', 'binding', 'index', 'local', 'credential'):
            with self.subTest(change=change):
                fx.posts, fx.pull = 0, None
                def changed():
                    if not fx.posts:
                        return
                    if change == 'head':
                        fx.advance_remote(b'uncertain remote race\n')
                    elif change == 'base':
                        with Repo(fx.remote) as repo:
                            repo.refs[b'refs/heads/main'] = self.head.encode()
                    elif change == 'default':
                        self.default_branch = 'feature/work'
                    elif change == 'binding':
                        with fx.store.connect() as db:
                            db.execute("UPDATE github_connections SET default_branch='other'")
                    elif change == 'credential':
                        fx.vault.save('Fixture', 'github', 'https://github.com',
                            {'token': 'synthetic-uncertain-replacement-ONLY'}, fx.item['id'])
                    else:
                        fx.edit(data=b'uncertain local race\n')
                        if change == 'index':
                            with Repo(fx.workspace) as repo:
                                repo.get_worktree().stage(['hello.txt'])
                self.lookup_hook = changed
                result = self.create_pr()
                self.assertFalse(result['ok'])
                self.assertTrue(result['uncertain_creation'])
                self.assertEqual(fx.posts, 1)
                self.assertNotIn(fixtures.fixtures.SYNTHETIC, str(result))
                self.lookup_hook = None
                self.default_branch = 'main'
                fx.edit()
                with Repo(fx.workspace) as repo:
                    repo.get_worktree().stage(['hello.txt'])
                with Repo(fx.remote) as repo:
                    repo.refs[b'refs/heads/main'] = self.base.encode()
                    repo.refs[b'refs/heads/feature/work'] = self.head.encode()
                fx.vault.save('Fixture', 'github', 'https://github.com',
                              {'token': fixtures.fixtures.SYNTHETIC}, fx.item['id'])
                with fx.store.connect() as db:
                    db.execute("UPDATE github_connections SET default_branch='main'")

    def test_last_network_check_cannot_change_binding_or_refs_before_pr_post(self):
        self.ready_pr()
        original = self.fx.service._branch_permission
        for change in ('binding', 'refs'):
            with self.subTest(change=change):
                def late(*args, **kwargs):
                    original(*args, **kwargs)
                    if self.lookups and not self.fx.posts:
                        if change == 'binding':
                            with self.fx.store.connect() as db:
                                db.execute("UPDATE github_connections SET default_branch='other'")
                        else:
                            self.fx.advance_remote(b'last network check race\n')
                with patch.object(self.fx.service, '_branch_permission', side_effect=late):
                    with self.assertRaises(ValueError):
                        self.create_pr()
                self.assertEqual(self.fx.posts, 0)
                self.lookups = 0
                with self.fx.store.connect() as db:
                    db.execute("UPDATE github_connections SET default_branch='main'")
                with Repo(self.fx.remote) as repo:
                    repo.refs[b'refs/heads/feature/work'] = self.head.encode()

    def test_actual_parent_writer_waits_for_child_git_lease(self):
        fx = self.fx
        from glitch.tools import WorkspaceTools
        child = fx.workspace / 'child'
        child.mkdir()
        (child / 'hello.txt').write_text('before', encoding='utf-8')
        resources, entered, failures = fx.service.resources, threading.Event(), []
        def approved(action, preview):
            resources.acquire(action, fx.workspace, fx.cancel)
            return True
        tools = WorkspaceTools(fx.workspace, approved, lambda *args: None, fx.cancel)
        def writer():
            try:
                tools.execute('write_file', {'path': 'child/hello.txt', 'content': 'after'})
                entered.set()
            except Exception as error:
                failures.append(type(error).__name__)
            finally:
                resources.release()
        resources.acquire('GitHub mutation', child, fx.cancel)
        worker = threading.Thread(target=writer)
        worker.start()
        try:
            self.assertFalse(entered.wait(.15), 'Parent file writer bypassed active child Git lease')
            self.assertEqual((child / 'hello.txt').read_text('utf-8'), 'before')
        finally:
            resources.release()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(failures, [])
        self.assertTrue(entered.is_set())

    def test_clone_engine_pauses_with_frozen_scope_and_restart_uses_explicit_child_task(self):
        fx = self.fx
        fx.edit(data=b'parent-root-only\n')
        child = fx.workspace / 'child'
        clone = {'name': 'github_clone_repo', 'args': {'folder': 'child'}}
        class Models(fixtures.ContextModelFixture):
            def __init__(self, decisions):
                self.decisions, self.calls, self.systems = decisions, 0, []
            def chat(self, settings, messages, cancel):
                self.systems.append(str(messages[0]['content']))
                tool = self.decisions[self.calls] if self.calls < len(self.decisions) else None
                self.calls += 1
                return {'done': tool is None, 'message': 'Fixture read complete' if tool is None else '', 'tool': tool}
        # These following actions must not run at all in the original conversation.
        decisions = [clone, {'name': 'github_repo_status', 'args': {}},
                     {'name': 'read_file', 'args': {'path': 'hello.txt'}},
                     {'name': 'browser_action', 'args': {'action': 'navigate', 'url': (child / 'hello.txt').as_uri()}}]
        models = Models(decisions)
        computer = Mock()
        computer.execute.return_value = {'ok': True}
        engine = AgentEngine(fx.store, models)
        with patch('glitch.engine.GitHubService', return_value=fx.service), \
                patch('glitch.engine.ComputerTools', return_value=computer), \
                patch.object(engine, '_approve_action', return_value=True):
            engine.run_sync(fx.session, 'Clone the bound repository into child for a later task')
        self.assertEqual(models.calls, 1, 'Model continued after clone against the old frozen root')
        computer.execute.assert_not_called()
        events = fx.store.events(fx.session, 0)
        self.assertEqual(events[-1]['kind'], 'paused')
        result = next(e['payload']['result'] for e in events if e['kind'] == 'result' and e['title'] == 'github_clone_repo')
        self.assertEqual(Path(result['active_workspace']), fx.workspace)
        self.assertEqual(Path(result['clone_workspace']), child)
        self.assertTrue(result['continuation_required'])
        child_session = result['child_session_id']
        self.assertEqual(Path(fx.store.session(fx.session)['workspace']), fx.workspace)
        self.assertEqual(Path(fx.store.session(child_session)['workspace']), child)
        self.assertEqual((fx.workspace / 'hello.txt').read_bytes(), b'parent-root-only\n')
        self.assertIn(fx.workspace.as_posix().casefold(), models.systems[0].casefold())
        self.assertTrue(fx.tools.execute('github_repo_status', {})['ok'])
        # A new user task explicitly selects the persisted child conversation.
        reopened = Store(fx.store.directory)
        reopened._vault = fixtures.fixtures.Vault(reopened, cipher=fixtures.fixtures.fixture_cipher)
        service = fixtures.GitHubService(reopened.vault, http=fx.http, git_factory=fx.client)
        resumed = Models(decisions[1:])
        next_engine = AgentEngine(reopened, resumed)
        with patch('glitch.engine.GitHubService', return_value=service), \
                patch('glitch.engine.ComputerTools', return_value=computer), \
                patch.object(next_engine, '_approve_action', return_value=True):
            next_engine.run_sync(child_session, 'Inspect the selected child project and its local file URL')
        results = {e['title']: e['payload']['result'] for e in reopened.events(child_session, 0) if e['kind'] == 'result'}
        self.assertTrue(results['github_repo_status']['ok'])
        self.assertEqual(results['read_file']['content'], 'hello\n')
        self.assertIn(child.as_posix().casefold(), resumed.systems[0].casefold())
        computer.execute.assert_called_once_with('browser_action', decisions[-1]['args'])
        self.assertEqual(Path(reopened.session(fx.session)['workspace']), fx.workspace)

    def test_nested_clone_is_excluded_from_parent_git_and_cannot_be_staged(self):
        fx = self.fx
        result = fx.tools.execute('github_clone_repo', {'folder': 'child'})
        self.assertTrue(result['ok'])
        status = fx.tools.execute('github_repo_status', {})
        self.assertTrue(status['ok'])
        self.assertEqual(status['nested_repositories'], ['child'])
        self.assertEqual(status['untracked'], [])
        with self.assertRaisesRegex(ValueError, 'nested checkout'):
            fx.tools.execute('github_diff', {'paths': ['child/hello.txt']})
        fx.branch()
        fx.edit()
        self.assertTrue(fx.publish()['ok'])
        with Repo(fx.remote) as repo:
            head = repo[repo.refs[b'refs/heads/feature/work']]
            names = [entry.path for entry in fixtures.iter_tree_contents(repo.object_store, head.tree)]
        self.assertEqual(names, [b'hello.txt'])
        self.assertEqual((fx.workspace / 'child/hello.txt').read_bytes(), b'hello\n')

    def test_clone_preview_exposes_exact_approved_destination_and_scope_contract(self):
        fx = self.fx
        result = fx.tools.execute('github_clone_repo', {'folder': 'child'})
        self.assertTrue(result['ok'])
        self.assertEqual(fx.previews[-1]['clone_destination'], str(fx.workspace / 'child'))
        self.assertEqual(fx.previews[-1]['workspace'], str(fx.workspace))
        self.assertTrue(fx.previews[-1]['continuation_required'])
        ui = Path(__file__).resolve().parents[1] / 'ui'
        html, js = (ui / 'index.html').read_text('utf-8'), (ui / 'app.js').read_text('utf-8')
        self.assertIn('id="review-destination"', html)
        self.assertIn("$('review-destination').textContent", js)

    def test_guard_refusal_remains_a_safe_actionable_github_diagnostic(self):
        fx = self.fx
        with fx.service.resources.human_review(fx.cancel, workspace=fx.workspace / 'child'):
            with self.assertRaisesRegex(ValueError, 'Overlapping workspace mutations are paused'):
                fx.tools.execute('github_create_branch', {'branch': 'feature/blocked'})

    def test_failed_clone_registration_rolls_back_metadata_and_retains_destination(self):
        fx = self.fx
        original = fx.store._bind_github
        def failure(db, workspace, connection):
            original(db, workspace, connection)
            raise ValueError('Untrusted database detail ' + fixtures.fixtures.SYNTHETIC)
        with patch.object(fx.store, '_bind_github', side_effect=failure):
            result = fx.tools.execute('github_clone_repo', {'folder': 'child'})
        self.assertFalse(result['ok'])
        self.assertTrue(result['clone_retained'])
        self.assertTrue(result['continuation_required'])
        self.assertNotIn(fixtures.fixtures.SYNTHETIC, str(result))
        self.assertIsNone(fx.store.github_connection(fx.workspace / 'child'))
        self.assertEqual(len(fx.store.sessions()), 1)
        self.assertEqual(len(fx.store.projects()), 1)
        self.assertEqual((fx.workspace / 'child/hello.txt').read_bytes(), b'hello\n')

    def test_clone_preserves_sibling_session_scope_and_typed_child_identifiers(self):
        fx = self.fx
        sibling = fx.store.new_session(fx.workspace)
        before = fx.store.session(sibling)
        fx.vault.save('Protocol collision', 'bearer', 'https://example.invalid', {'token': 'child_session_id'})
        result = fx.tools.execute('github_clone_repo', {'folder': 'child'})
        self.assertTrue(result['ok'])
        self.assertEqual(fx.store.session(sibling), before)
        self.assertEqual(Path(fx.store.session(result['child_session_id'])['workspace']), fx.workspace / 'child')
        self.assertNotIn('secret', result)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.child = self.root / 'child'
        self.other = self.root / 'other'
        self.child.mkdir()
        self.other.mkdir()
        self.resources = ResourceCoordinator()
        self.cancel = threading.Event()

    def test_parent_child_mutations_conflict_in_both_directions(self):
        for held, requested in ((self.root, self.child), (self.child, self.root)):
            for action in ('Write file', 'Run command', 'GitHub mutation'):
                with self.subTest(held=held, action=action):
                    entered = threading.Event()
                    self.resources.acquire('GitHub mutation', held, self.cancel)
                    def work():
                        with self.resources.lease(action, requested, self.cancel):
                            entered.set()
                    worker = threading.Thread(target=work)
                    worker.start()
                    try:
                        self.assertFalse(entered.wait(.1))
                    finally:
                        self.resources.release()
                        worker.join(2)
                    self.assertTrue(entered.is_set())
                    self.assertFalse(worker.is_alive())

    def test_disjoint_siblings_are_not_serialized_by_an_idle_registered_parent(self):
        with self.resources.lease('Write file', self.root, self.cancel):
            pass
        with self.resources.lease('GitHub mutation', self.child, self.cancel):
            entered = threading.Event()
            def work():
                with self.resources.lease('Run command', self.other, self.cancel):
                    entered.set()
            worker = threading.Thread(target=work)
            worker.start()
            worker.join(2)
            self.assertTrue(entered.is_set())
            self.assertFalse(worker.is_alive())

    def test_nested_owned_leases_restore_parent_without_self_deadlock(self):
        self.resources.acquire('Write file', self.root, self.cancel)
        parent_lock = self.resources.local.held
        self.resources.acquire('GitHub mutation', self.child, self.cancel)
        self.resources.release()
        try:
            self.assertIs(self.resources.local.held, parent_lock)
        finally:
            self.resources.release()

    def test_overlapping_waiter_cancellation_does_not_enter_or_poison_admission(self):
        self.resources.acquire('Write file', self.root, self.cancel)
        cancelled, outcome = threading.Event(), []
        def work():
            try:
                with self.resources.lease('GitHub mutation', self.child, cancelled):
                    outcome.append('entered')
            except InterruptedError:
                outcome.append('cancelled')
        worker = threading.Thread(target=work)
        worker.start()
        cancelled.set()
        worker.join(2)
        self.resources.release()
        self.assertEqual(outcome, ['cancelled'])
        self.assertFalse(worker.is_alive())
        with self.resources.lease('GitHub mutation', self.child, self.cancel):
            pass

    def test_earlier_overlapping_parent_waiter_is_not_bypassed_by_later_child(self):
        order, started = [], threading.Event()
        self.resources.acquire('GitHub mutation', self.child, self.cancel)
        def parent():
            started.set()
            with self.resources.lease('Write file', self.root, self.cancel):
                order.append('parent')
        def child():
            with self.resources.lease('GitHub mutation', self.child, self.cancel):
                order.append('child')
        first = threading.Thread(target=parent)
        second = threading.Thread(target=child)
        first.start()
        started.wait(1)
        self.assertFalse(threading.Event().wait(.1))
        second.start()
        self.resources.release()
        first.join(2)
        second.join(2)
        self.assertEqual(order, ['parent', 'child'])
        self.assertFalse(first.is_alive() or second.is_alive())

    def test_pending_scoped_human_review_blocks_overlapping_mutations_without_lease(self):
        self.assertIn('workspace', inspect.signature(self.resources.human_review).parameters)
        with self.resources.human_review(self.cancel, workspace=self.child):
            self.assertIsNone(getattr(self.resources.local, 'held', None))
            for action in ('Write file', 'Run command', 'GitHub mutation', 'Desktop Input'):
                with self.subTest(action=action), self.assertRaises(ValueError):
                    self.resources.acquire(action, self.root, self.cancel)
            with self.resources.lease('Write file', self.other, self.cancel):
                pass
        with self.resources.lease('GitHub mutation', self.root, self.cancel):
            pass

    def test_human_review_drains_overlap_and_cancels_without_leaking_guard(self):
        self.assertIn('workspace', inspect.signature(self.resources.human_review).parameters)
        self.resources.acquire('Write file', self.root, self.cancel)
        stopped, outcome = threading.Event(), []
        def review():
            try:
                with self.resources.human_review(stopped, workspace=self.child):
                    outcome.append('entered')
            except InterruptedError:
                outcome.append('cancelled')
        worker = threading.Thread(target=review)
        worker.start()
        stopped.set()
        worker.join(2)
        self.resources.release()
        self.assertEqual(outcome, ['cancelled'])
        with self.resources.lease('Run command', self.root, self.cancel):
            pass

    def test_human_review_cannot_wait_while_caller_owns_a_raw_workspace_claim(self):
        lock = self.resources.workspace_lock(self.root)
        lock.acquire()
        timer = threading.Timer(.1, self.cancel.set)
        timer.start()
        try:
            with self.assertRaisesRegex(ValueError, 'Release resource leases'):
                with self.resources.human_review(self.cancel, workspace=self.child):
                    self.fail('Human review started while caller held an overlapping resource')
        finally:
            lock.release()
            timer.cancel()
            timer.join()

    def test_unrelated_owned_scope_cannot_bypass_earlier_overlapping_waiter(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        unrelated = Path(temporary.name)
        order, entered, failures = [], threading.Event(), []
        self.resources.acquire('GitHub mutation', self.child, self.cancel)
        def parent():
            with self.resources.lease('Write file', self.root, self.cancel):
                order.append('parent')
        def later():
            try:
                with self.resources.lease('Write file', unrelated, self.cancel):
                    try:
                        with self.resources.lease('GitHub mutation', self.other, self.cancel):
                            order.append('later')
                            entered.set()
                    except ValueError:
                        order.append('refused')
            except Exception as error:
                failures.append(type(error).__name__)
        first, second = threading.Thread(target=parent), threading.Thread(target=later)
        first.start()
        try:
            with self.resources.changed:
                self.assertTrue(self.resources.changed.wait_for(
                    lambda: any(key == workspace_identity(self.root) for _, key, _ in self.resources.waiters), 1))
            second.start()
            self.assertFalse(entered.wait(.1), 'An unrelated held scope bypassed the older overlapping waiter')
        finally:
            self.resources.release()
            first.join(2)
            if second.ident:
                second.join(2)
        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(order[0], 'parent')


if __name__ == '__main__':
    unittest.main()
