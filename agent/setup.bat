@echo off
title PhantomOS Agent - Setup
color 0B
echo.
echo  ╔══════════════════════════════════╗
echo  ║   PhantomOS Agent Installer      ║
echo  ║         v1.0.0                   ║
echo  ╚══════════════════════════════════╝
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Node.js not found. Installing...
    echo [!] Please install Node.js from https://nodejs.org/
    echo [!] Then run this script again.
    pause
    start https://nodejs.org/
    exit /b 1
)

echo [OK] Node.js found:
node --version

:: Check if cloudflared is installed
where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [!] cloudflared not found. Downloading...
    echo [!] Downloading cloudflared for Windows...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%USERPROFILE%\cloudflared.exe'"
    if exist "%USERPROFILE%\cloudflared.exe" (
        echo [OK] cloudflared downloaded to %USERPROFILE%\cloudflared.exe
        :: Add to PATH for this session
        set "PATH=%USERPROFILE%;%PATH%"
        echo [OK] Added to PATH for this session
        echo [!] To make permanent, add %USERPROFILE% to your system PATH
    ) else (
        echo [!] Failed to download. Get it from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    )
) else (
    echo [OK] cloudflared found
)

:: Install dependencies
echo.
echo [*] Installing dependencies...
cd /d "%~dp0"
call npm install --production
echo.

:: Run setup
echo [*] Starting agent setup...
echo.
node index.js --setup

:: Ask about Windows Service
echo.
set /p INSTALL_SVC="Install as Windows Service (starts on boot)? [Y/n]: "
if /i "%INSTALL_SVC%" neq "n" (
    echo.
    echo [*] Installing Windows Service (requires Administrator)...
    echo [*] If this fails, right-click setup.bat and "Run as administrator"
    node service.js install
)

echo.
echo ════════════════════════════════════════
echo   Setup complete!
echo   Agent will connect to PhantomBridge
echo   Dashboard: https://phantom-bridge.onrender.com/dashboard
echo ════════════════════════════════════════
echo.
pause
