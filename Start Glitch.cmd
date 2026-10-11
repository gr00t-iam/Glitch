@echo off
cd /d "%~dp0"
if exist "dist\Glitch-1.2.0\Glitch.exe" (
  start "" "%~dp0dist\Glitch-1.2.0\Glitch.exe"
  exit /b 0
)
if exist "dist\Glitch.exe" (
  start "" "%~dp0dist\Glitch.exe"
  exit /b 0
)
if exist "Glitch.exe" (
  start "" "%~dp0Glitch.exe"
  exit /b 0
)
echo Download Glitch.exe from the Glitch release and place it beside this file.
start "" "https://github.com/gr00t-iam/Glitch/releases/latest"
exit /b 1
