@echo off
title FileEasy - Installing...
echo.
echo  Installing FileEasy dependencies...
echo  (This only needs to be done once)
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed or not in PATH.
  echo  Please download and install Node.js from https://nodejs.org
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0"
call npm install

if errorlevel 1 (
  echo.
  echo  Installation failed. Please check the error above.
  pause
  exit /b 1
)

echo.
echo  Done! Run start.bat to launch FileEasy.
echo.
pause
