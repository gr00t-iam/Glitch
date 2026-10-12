"""Current-branch pull uses disposable real Git, no network or remote writes."""
from dulwich.repo import Repo
import unittest
from glitch.tests import test_github_tools as fixtures
from glitch.tests import test_github_service as backend


class PullTests(unittest.TestCase):
    setUp = fixtures.PublishingTests.setUp
    response = fixtures.PublishingTests.response
    client = fixtures.PublishingTests.client
    allow = fixtures.PublishingTests.allow
    edit = fixtures.PublishingTests.edit

    def incoming(self):
        with Repo(self.remote) as repo:
            parent = repo.head()
            backend.GitHubTests.commit(repo, {'hello.txt': b'pulled locally\n'})
            commit = repo[repo.head()]
            commit.parents = [parent]
            repo.object_store.add_object(commit)
            repo.refs[b'refs/heads/main'] = commit.id

    def test_default_branch_fast_forward_is_local_only(self):
        self.incoming()
        result = self.tools.execute('github_pull', {})
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['branch'], 'main')
        self.assertEqual((self.workspace / 'hello.txt').read_bytes(), b'pulled locally\n')
        self.assertEqual(self.pushes, 0)
        self.assertEqual(self.previews[-1]['operation'], 'github_pull')
        with self.assertRaises(ValueError):
            self.tools.execute('github_commit_and_push', {'paths': ['hello.txt'], 'branch': 'main',
                               'title': 'Forbidden', 'body': ''})

    def test_dirty_divergence_and_denial_do_not_update_checkout(self):
        self.incoming()
        self.edit(data=b'dirty\n')
        with self.assertRaises(ValueError):
            self.tools.execute('github_pull', {})
        self.edit(data=b'hello\n')
        self.approve.side_effect = lambda *_: False
        self.assertTrue(self.tools.execute('github_pull', {})['denied'])
        self.assertEqual((self.workspace / 'hello.txt').read_bytes(), b'hello\n')
        self.approve.side_effect = self.allow
        with Repo(self.workspace) as repo:
            backend.GitHubTests.commit(repo, {'hello.txt': b'local divergence\n'})
            self.edit(data=b'local divergence\n')
            repo.get_worktree().stage(['hello.txt'])
        with self.assertRaises(ValueError):
            self.tools.execute('github_pull', {})
        self.assertEqual(self.pushes, 0)

    def test_branch_switch_during_review_is_refused(self):
        self.incoming()
        def switched(*_):
            with Repo(self.workspace) as repo:
                repo.refs[b'refs/heads/other'] = repo.head()
                repo.refs.set_symbolic_ref(b'HEAD', b'refs/heads/other')
            return True
        self.approve.side_effect = switched
        with self.assertRaises(ValueError):
            self.tools.execute('github_pull', {})
        self.assertEqual((self.workspace / 'hello.txt').read_bytes(), b'hello\n')

    def test_full_access_pull_still_waits_for_approval(self):
        import threading
        from glitch.engine import AgentEngine
        self.store.save_settings({'full_access': True})
        engine = AgentEngine(self.store, None)
        engine.running_session = self.session
        results = []
        worker = threading.Thread(target=lambda: results.append(engine._approve('github_pull', {})))
        worker.start()
        try:
            for _ in range(100):
                if engine.state()['approval']:
                    break
                threading.Event().wait(.01)
            self.assertIsNotNone(engine.state()['approval'])
        finally:
            engine.stop()
            worker.join(3)
        self.assertEqual(results, [False])

    def test_approval_rechecks_current_branch_and_cancellation(self):
        self.incoming()
        def cancel(*_):
            self.cancel.set()
            return True
        self.approve.side_effect = cancel
        with self.assertRaises(InterruptedError):
            self.tools.execute('github_pull', {})
        self.assertEqual((self.workspace / 'hello.txt').read_bytes(), b'hello\n')
        self.assertEqual(self.pushes, 0)
