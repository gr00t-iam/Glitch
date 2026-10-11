# Build on Windows from the repository root:
# .venv-glitch\Scripts\python.exe -m PyInstaller --noconfirm --clean glitch\Glitch.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).parent
web_data, web_binaries, web_imports = collect_all('webview')
vosk_data, vosk_binaries, vosk_imports = collect_all('vosk')
sound_data, sound_binaries, sound_imports = collect_all('sounddevice')
com_data, com_binaries, com_imports = collect_all('comtypes')
runtime = root / 'glitch' / 'runtime' / 'llama-cpp'
cuda_runtime = root / 'glitch' / 'runtime' / 'llama-cpp-cuda'
if not (runtime / 'llama-server.exe').is_file():
    raise RuntimeError('Run python -m glitch.prepare_runtime before packaging.')
if not (cuda_runtime / 'llama-server.exe').is_file():
    raise RuntimeError('The CUDA runtime is missing. Run python -m glitch.prepare_runtime.')
runtime_data = [(str(file), 'glitch/runtime/' + directory.name)
                for directory in (runtime, cuda_runtime) for file in directory.iterdir()
                if file.is_file() and (file.suffix.lower() == '.dll' or file.name == 'llama-server.exe'
                                       or file.name.startswith('LICENSE') or file.name == 'archive.sha256')]

a = Analysis(
    [str(root / 'glitch' / 'launcher.py')], pathex=[str(root)],
    binaries=web_binaries + vosk_binaries + sound_binaries + com_binaries,
    datas=web_data + vosk_data + sound_data + com_data + runtime_data + [(str(root / 'glitch' / 'ui'), 'glitch/ui'), (str(root / 'glitch' / 'licenses'), 'glitch/licenses'), (str(root / 'glitch' / 'tests' / 'fixtures'), 'glitch/tests/fixtures')],
    hiddenimports=web_imports + vosk_imports + sound_imports + com_imports + ['_sounddevice_data', 'webview.platforms.winforms', 'webview.platforms.edgechromium',
                               'pyautogui', 'PIL.Image', 'websocket', 'psutil', 'discord', 'glitch.tests.smoke_desktop', 'glitch.tests.smoke_inference', 'glitch.tests.smoke_parallel', 'glitch.tests.smoke_voice', 'glitch.tests.smoke_gpu'],
    excludes=['llama_cpp', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi', 'cefpython3', 'webview.platforms.android'],
    noarchive=False,
)
# Dependency analysis also copies CUDA libraries into the Python root. These
# are private child-process dependencies, already beside each llama-server.
a.binaries = [entry for entry in a.binaries if not (
    any(Path(entry[1]).resolve().is_relative_to(directory.resolve()) for directory in (runtime, cuda_runtime))
    and not entry[0].replace('\\', '/').startswith('glitch/runtime/'))]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='Glitch',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False)
