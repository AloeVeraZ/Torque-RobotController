@echo off
rem Deck simulation from a terminal: deck-sim help
rem Uses Node.js when it is on PATH, otherwise the app's own Electron runtime as Node.
setlocal
set "SCRIPT=%~dp0tools\deck-sim.cjs"
where node >nul 2>nul
if not errorlevel 1 (
  node "%SCRIPT%" %*
  goto done
)
set "ELECTRON_RUN_AS_NODE=1"
set "RUNTIME=%~dp0.cache\runtime-win32-x64-44.8.0\electron.exe"
if not exist "%RUNTIME%" set "RUNTIME=%LOCALAPPDATA%\DeckDriverStation\runtime\electron.exe"
if not exist "%RUNTIME%" (
  echo Node.js was not found. Install Node.js or Torque, then try again.
  exit /b 1
)
"%RUNTIME%" "%SCRIPT%" %*
:done
exit /b %errorlevel%
