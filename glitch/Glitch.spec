# Build on Windows from the repository root:
# .venv-glitch\Scripts\python.exe -m PyInstaller --noconfirm --clean glitch\Glitch.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).parent
web_data, web_binaries, web_imports = collect_all('webview')
llama_data, llama_binaries, llama_imports = collect_all('llama_cpp')

a = Analysis(
    [str(root / 'glitch' / 'launcher.py')], pathex=[str(root)],
    binaries=web_binaries + llama_binaries,
    datas=web_data + llama_data + [(str(root / 'glitch' / 'ui'), 'glitch/ui')],
    hiddenimports=web_imports + llama_imports + ['webview.platforms.winforms', 'webview.platforms.edgechromium',
                               'pyautogui', 'PIL.Image', 'websocket', 'psutil', 'discord', 'glitch.tests.smoke_desktop', 'glitch.tests.smoke_inference'],
    excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi', 'cefpython3', 'webview.platforms.android'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='Glitch',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False)
