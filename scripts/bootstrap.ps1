# IT Dashboard Agent - Bootstrap Installer
# This script downloads and runs the full installer
# Usage: irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/bootstrap.ps1 | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "IT Dashboard Agent - Bootstrap Installer" -ForegroundColor Cyan
Write-Host "Downloading installer..." -ForegroundColor Yellow

$installerUrl = "https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.ps1"
$installerPath = "$env:TEMP\install-it-dashboard-agent.ps1"

try {
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "Running installer..." -ForegroundColor Yellow
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
} finally {
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
}
