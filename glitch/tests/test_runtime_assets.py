import tempfile
import unittest
import zipfile
from pathlib import Path
from glitch.runtime_assets import safe_extract


class AssetTests(unittest.TestCase):
    def test_zip_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('../escape', 'bad')
            with self.assertRaises(ValueError):
                safe_extract(archive, Path(root) / 'out')
            self.assertFalse((Path(root) / 'escape').exists())

    def test_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as z:
                member = zipfile.ZipInfo('link')
                member.external_attr = 0o120777 << 16
                z.writestr(member, 'target')
            with self.assertRaises(ValueError):
                safe_extract(archive, Path(root) / 'out')
