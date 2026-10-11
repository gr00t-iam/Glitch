import tempfile
import unittest
import zipfile
import subprocess
from unittest.mock import patch
from pathlib import Path
from glitch.runtime_assets import safe_extract


class AssetTests(unittest.TestCase):
    def test_auto_processing_detects_cuda_or_falls_back_to_cpu(self):
        from glitch.runtime_assets import select_runtime
        with tempfile.TemporaryDirectory() as root:
            cpu, cuda = Path(root) / 'cpu', Path(root) / 'cuda'
            cpu.mkdir()
            cuda.mkdir()
            (cpu / 'llama-server.exe').touch()
            (cuda / 'llama-server.exe').touch()
            with patch('glitch.runtime_assets.runtime_directory', side_effect=lambda backend='cpu': cuda if backend == 'cuda' else cpu):
                with patch('glitch.runtime_assets.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'CUDA0: NVIDIA GPU', b'')):
                    self.assertEqual(select_runtime('auto'), (cuda / 'llama-server.exe', 'cuda'))
                    self.assertEqual(select_runtime('cpu'), (cpu / 'llama-server.exe', 'cpu'))
                with patch('glitch.runtime_assets.subprocess.run', side_effect=OSError('driver unavailable')):
                    self.assertEqual(select_runtime('auto'), (cpu / 'llama-server.exe', 'cpu'))
                    with self.assertRaises(RuntimeError):
                        select_runtime('cuda')

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
