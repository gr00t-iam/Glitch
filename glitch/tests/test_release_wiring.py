"""Release entrypoints must stay disposable and available to a frozen executable."""
import unittest
from pathlib import Path


class ReleaseWiringTests(unittest.TestCase):
    def test_frozen_fixture_entrypoints_and_version(self):
        from glitch import __version__
        self.assertEqual(__version__, '1.3.0')
        root = Path(__file__).resolve().parents[1]
        launcher = (root / 'launcher.py').read_text()
        spec = (root / 'Glitch.spec').read_text()
        for name in ('vault', 'history', 'context', 'github', 'github-tools', 'integration'):
            self.assertIn('--' + name + '-test', launcher)
            self.assertIn('glitch.tests.smoke_' + name.replace('-', '_'), spec)
        workflow = (root.parent / '.github/workflows/glitch-windows.yml').read_text()
        self.assertIn('--integration-test', workflow)
        self.assertNotIn('--gpu-test', workflow)
