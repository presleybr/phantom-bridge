#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PhantomOS Agent - One-Click Installer for Windows
.DESCRIPTION
    Downloads PhantomAgent.exe + cloudflared.exe, runs setup, and optionally installs as Windows Service.

    Usage (run in PowerShell as Administrator):
      irm https://phantom-bridge.onrender.com/agent/install.ps1 | iex

    Or download and run:
      .\install.ps1
#>

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host "    PhantomOS Agent Installer v1.0.0" -ForegroundColor Cyan
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host ""

# Install directory
$installDir = "$env:ProgramFiles\PhantomAgent"
Write-Host "[*] Install directory: $installDir" -ForegroundColor Yellow

if (!(Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Write-Host "[OK] Created directory" -ForegroundColor Green
}

# Download PhantomAgent.exe
$agentUrl = "https://phantom-bridge.onrender.com/agent/dist/PhantomAgent.exe"
$agentPath = "$installDir\PhantomAgent.exe"
Write-Host ""
Write-Host "[*] Downloading PhantomAgent.exe..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri $agentUrl -OutFile $agentPath -UseBasicParsing
    Write-Host "[OK] PhantomAgent.exe downloaded" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to download PhantomAgent.exe" -ForegroundColor Red
    Write-Host "  URL: $agentUrl" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    exit 1
}

# Download cloudflared.exe
$cfPath = "$installDir\cloudflared.exe"
if (!(Test-Path $cfPath)) {
    Write-Host ""
    Write-Host "[*] Downloading cloudflared.exe..." -ForegroundColor Yellow
    $cfUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    try {
        Invoke-WebRequest -Uri $cfUrl -OutFile $cfPath -UseBasicParsing
        Write-Host "[OK] cloudflared.exe downloaded" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Failed to download cloudflared.exe" -ForegroundColor Yellow
        Write-Host "  Download manually from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] cloudflared.exe already exists" -ForegroundColor Green
}

# Create default config.json if not exists
$configPath = "$installDir\config.json"
if (!(Test-Path $configPath)) {
    $defaultConfig = @{
        bridgeUrl = "https://phantom-bridge.onrender.com"
        bridgeToken = ""
        agentId = ""
        agentName = ""
        agentToken = ""
        localPort = 4000
        heartbeatInterval = 30000
        tunnelEnabled = $true
    } | ConvertTo-Json -Depth 2
    $defaultConfig | Out-File -FilePath $configPath -Encoding UTF8
    Write-Host "[OK] Default config.json created" -ForegroundColor Green
}

# Add to PATH
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
if ($currentPath -notlike "*PhantomAgent*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$installDir", "Machine")
    $env:PATH = "$env:PATH;$installDir"
    Write-Host "[OK] Added to system PATH" -ForegroundColor Green
}

# Run setup
Write-Host ""
Write-Host "[*] Starting agent setup..." -ForegroundColor Yellow
Write-Host "  Configure your agent ID, name, and bridge connection." -ForegroundColor Gray
Write-Host ""
Push-Location $installDir
& "$agentPath" --setup
Pop-Location

# Ask about Windows Service
Write-Host ""
$installSvc = Read-Host "Install as Windows Service (auto-start on boot)? [Y/n]"
if ($installSvc -ne "n" -and $installSvc -ne "N") {
    Write-Host ""
    Write-Host "[*] Creating Windows Service..." -ForegroundColor Yellow

    # Use sc.exe to create service (no Node.js needed)
    $svcName = "PhantomAgent"
    $svcExists = Get-Service -Name $svcName -ErrorAction SilentlyContinue

    if ($svcExists) {
        Write-Host "[WARN] Service already exists. Stopping and removing..." -ForegroundColor Yellow
        Stop-Service -Name $svcName -Force -ErrorAction SilentlyContinue
        sc.exe delete $svcName | Out-Null
        Start-Sleep -Seconds 2
    }

    # Create the service
    sc.exe create $svcName binPath= "`"$agentPath`"" start= auto DisplayName= "PhantomOS Agent" | Out-Null
    sc.exe description $svcName "PhantomOS remote control agent - connects this PC to PhantomBridge" | Out-Null

    # Start the service
    Start-Service -Name $svcName -ErrorAction SilentlyContinue
    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host "[OK] Service installed and running!" -ForegroundColor Green
    } else {
        Write-Host "[OK] Service installed. Starting manually..." -ForegroundColor Yellow
        Write-Host "  Run: Start-Service PhantomAgent" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host "    Setup complete!" -ForegroundColor Green
Write-Host "    Agent will connect to PhantomBridge" -ForegroundColor White
Write-Host "    Dashboard: https://phantom-bridge.onrender.com/dashboard" -ForegroundColor White
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To start manually: PhantomAgent.exe" -ForegroundColor Gray
Write-Host "  To reconfigure:    PhantomAgent.exe --setup" -ForegroundColor Gray
Write-Host "  Config file:       $configPath" -ForegroundColor Gray
Write-Host ""
