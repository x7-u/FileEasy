@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo  First run — installing dependencies...
  call npm install
)

:: Launch Electron as a detached background process so this window closes immediately
start "" /B npx.cmd electron .
