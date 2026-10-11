# Build on Windows from the repository root:
# .venv-glitch\Scripts\python.exe -m PyInstaller --noconfirm --clean glitch\Glitch.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).parent
web_data, web_binaries, web_imports = collect_all('webview')
llama_data, llama_binaries, llama_imports = collect_all('llama_cpp')
vosk_data, vosk_binaries, vosk_imports = collect_all('vosk')
sound_data, sound_binaries, sound_imports = collect_all('sounddevice')
com_data, com_binaries, com_imports = collect_all('comtypes')
runtime = root / 'glitch' / 'runtime' / 'llama-cpp'
if not (runtime / 'llama-server.exe').is_file():
    raise RuntimeError('Run python -m glitch.prepare_runtime before packaging.')

a = Analysis(
    [str(root / 'glitch' / 'launcher.py')], pathex=[str(root)],
    binaries=web_binaries + llama_binaries + vosk_binaries + sound_binaries + com_binaries,
    datas=web_data + llama_data + vosk_data + sound_data + com_data + [(str(runtime), 'glitch/runtime/llama-cpp'), (str(root / 'glitch' / 'ui'), 'glitch/ui'), (str(root / 'glitch' / 'licenses'), 'glitch/licenses'), (str(root / 'glitch' / 'tests' / 'fixtures'), 'glitch/tests/fixtures')],
    hiddenimports=web_imports + llama_imports + vosk_imports + sound_imports + com_imports + ['_sounddevice_data', 'webview.platforms.winforms', 'webview.platforms.edgechromium',
                               'pyautogui', 'PIL.Image', 'websocket', 'psutil', 'discord', 'glitch.tests.smoke_desktop', 'glitch.tests.smoke_inference', 'glitch.tests.smoke_parallel', 'glitch.tests.smoke_voice'],
    excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi', 'cefpython3', 'webview.platforms.android'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='Glitch',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False)
