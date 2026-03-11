@echo off
title PhantomOS Agent - Build Installer
color 0B
echo.
echo  ========================================
echo    PhantomOS Agent - Build Pipeline
echo  ========================================
echo.

:: Step 1: Build PhantomAgent.exe with pkg
echo [1/4] Building PhantomAgent.exe...
cd /d "%~dp0\.."
if not exist "node_modules\pkg" (
    echo [*] Installing pkg...
    call npm install
)
call npm run build
if not exist "dist\PhantomAgent.exe" (
    echo [ERROR] Build failed! dist\PhantomAgent.exe not found.
    pause
    exit /b 1
)
echo [OK] PhantomAgent.exe built successfully
echo.

:: Step 2: Download cloudflared if not present
echo [2/4] Checking cloudflared.exe...
if not exist "dist\cloudflared.exe" (
    echo [*] Downloading cloudflared.exe...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'dist\cloudflared.exe'"
    if exist "dist\cloudflared.exe" (
        echo [OK] cloudflared.exe downloaded
    ) else (
        echo [WARN] Download failed. Installer will work without it.
        echo [WARN] Clients can download cloudflared manually.
    )
) else (
    echo [OK] cloudflared.exe already exists
)
echo.

:: Step 3: Check for Inno Setup
echo [3/4] Checking Inno Setup...
set ISCC=""
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"
) else (
    where iscc >nul 2>nul
    if %errorlevel% equ 0 (
        set ISCC=iscc
    ) else (
        echo [ERROR] Inno Setup 6 not found!
        echo [ERROR] Download from: https://jrsoftware.org/isdl.php
        echo.
        echo [INFO] PhantomAgent.exe was built successfully in dist\
        echo [INFO] You can distribute it manually without the installer.
        pause
        exit /b 1
    )
)
echo [OK] Inno Setup found
echo.

:: Step 4: Compile installer
echo [4/4] Compiling installer...
cd /d "%~dp0"

:: Create icon if not exists
if not exist "icon.ico" (
    echo [WARN] icon.ico not found. Using default Windows icon.
    echo [INFO] Place a custom icon.ico in the installer\ folder for branding.
    :: Remove IconFile line temporarily by using a modified iss
    powershell -Command "(Get-Content 'setup.iss') -replace 'SetupIconFile=icon.ico', '; SetupIconFile=icon.ico' | Set-Content 'setup-temp.iss'"
    %ISCC% setup-temp.iss
    del setup-temp.iss 2>nul
) else (
    %ISCC% setup.iss
)

if exist "output\PhantomAgent-Setup-1.0.0.exe" (
    echo.
    echo ========================================
    echo   BUILD COMPLETE!
    echo.
    echo   Installer: installer\output\PhantomAgent-Setup-1.0.0.exe
    echo   Agent:     dist\PhantomAgent.exe
    echo.
    echo   Upload the installer to your server
    echo   or distribute directly to clients.
    echo ========================================
) else (
    echo [ERROR] Installer compilation failed.
)
echo.
pause
