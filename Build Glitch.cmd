@echo off
setlocal
cd /d "%~dp0"
py -3.12 -m venv .venv-glitch
if errorlevel 1 goto failed
".venv-glitch\Scripts\python.exe" -m pip install -r glitch\requirements-lock.txt
if errorlevel 1 goto failed
".venv-glitch\Scripts\python.exe" -m unittest discover -s glitch\tests -v
if errorlevel 1 goto failed
".venv-glitch\Scripts\python.exe" -m glitch.prepare_runtime
if errorlevel 1 goto failed
".venv-glitch\Scripts\python.exe" -m PyInstaller --noconfirm --clean glitch\Glitch.spec
if errorlevel 1 goto failed
echo.
echo Glitch is ready: %cd%\dist\Glitch.exe
start "" explorer.exe "%cd%\dist"
pause
exit /b 0
:failed
echo.
echo Build failed. Install Python 3.12 x64 from python.org, then try again.
pause
exit /b 1
