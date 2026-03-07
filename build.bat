@echo off
cd /d "%~dp0"

:: ── electron-builder needs the "Create symbolic links" privilege to extract
:: ── its code-signing tools. Auto-elevate to Admin to get it.
:: ── Alternative: enable Windows Developer Mode (Settings → Privacy &
:: ──   Security → For Developers → Developer Mode) then re-run as normal user.
net session >nul 2>&1
if errorlevel 1 (
  echo  Requesting administrator privileges...
  powershell -Command "Start-Process '%~f0' -Verb RunAs -Wait"
  exit /b
)

title FileEasy — Building Installer
echo.
echo  FileEasy — Installer Builder
echo  ==============================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js not found. Download from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo  Installing dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo  Dependency install failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo  Building installer... this takes a few minutes the first time.
echo  (electron-builder downloads Electron ~100 MB if not cached)
echo.

call npm run dist
if errorlevel 1 (
  echo.
  echo  Build failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   Done!  FileEasy-Setup-1.0.0.exe is in the dist\ folder.
echo   Double-click it to install FileEasy on any Windows PC.
echo  ============================================================
echo.
explorer "%~dp0dist"
pause
