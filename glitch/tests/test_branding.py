"""Keep the repository and consumer entry points consistent with the product."""

import re
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class BrandingTests(unittest.TestCase):
    def test_tracked_files_use_current_product_name(self):
        if not shutil.which('git') or not (ROOT / '.git').exists():
            self.skipTest('Repository branding audit requires a Git checkout')
        names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
        retired = bytes([110, 101, 120, 117, 115]).decode() + r'[-_ ]?' + 'harness'
        pattern = re.compile(retired, re.IGNORECASE)
        failures = []
        for name in names:
            path = ROOT / name
            if not name or not path.is_file():
                continue
            if pattern.search(name):
                failures.append(name + ': filename')
            data = path.read_bytes()
            if b'\0' in data:
                continue
            if pattern.search(data.decode('utf-8', errors='replace')):
                failures.append(name + ': contents')
        self.assertEqual(failures, [])

    def test_consumer_docs_link_to_current_repository_and_executable(self):
        for name in ('README.md', 'START HERE - How to run Glitch.md', 'glitch/README.md'):
            with self.subTest(name=name):
                content = (ROOT / name).read_text(encoding='utf-8')
                self.assertIn('Glitch.exe', content)
                self.assertIn('https://github.com/gr00t-iam/Glitch/releases/latest', content)
        self.assertTrue((ROOT / 'Start Glitch.cmd').exists())
        self.assertIn('retained', (ROOT / 'README.md').read_text().lower())

    def test_primary_documentation_local_links_exist(self):
        for name in ('README.md', 'START HERE - How to run Glitch.md',
                     'Glitch - Project Handoff Specification.md', 'glitch/README.md',
                     'docs/legacy-development.md'):
            path = ROOT / name
            for target in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
                target = target.strip('<>').split('#', 1)[0]
                if not target or '://' in target:
                    continue
                with self.subTest(document=name, target=target):
                    self.assertTrue((path.parent / target).exists())
