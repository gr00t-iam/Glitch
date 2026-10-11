@echo off
title NexusHarness
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required to run NexusHarness.
  echo   Download the LTS version from https://nodejs.org , install it,
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

REM If the server is already running, just open the app and exit.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo NexusHarness is already running. Opening it...
  start "" http://127.0.0.1:5173
  exit /b 0
)

if not exist "node_modules" (
  echo.
  echo   First-time setup: installing dependencies. This can take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Dependency install failed. Open a terminal here and run:  npm install
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  ===================================================
echo    NexusHarness is starting...
echo    It will open automatically at:
echo        http://127.0.0.1:5173
echo.
echo    Keep this window OPEN while you use the app.
echo    Close this window to stop NexusHarness.
echo  ===================================================
echo.

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0open-when-ready.ps1"
call npm run dev

echo.
echo NexusHarness has stopped. Press any key to close.
pause >nul
