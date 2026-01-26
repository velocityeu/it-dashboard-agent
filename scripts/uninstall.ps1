#Requires -Version 5.1
<#
.SYNOPSIS
    IT Dashboard Agent - Windows Uninstaller
.DESCRIPTION
    Removes IT Dashboard Agent from Windows, including service and all files.
.EXAMPLE
    irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.ps1 | iex
.NOTES
    Version: 1.0.0
    Author: Velocity EU
#>

[CmdletBinding()]
param(
    [string]$InstallPath = "$env:ProgramData\it-dashboard-agent",
    [switch]$KeepConfig,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ServiceName = "ITDashboardAgent"

# Colors
function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Write-Banner {
    Clear-Host
    Write-ColorText @"

  IT Dashboard Agent - Uninstaller
  =================================

"@ "Cyan"
}

function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Request-Elevation {
    if (-not (Test-Administrator)) {
        Write-ColorText "This uninstaller requires Administrator privileges." "Yellow"
        Write-ColorText "Restarting with elevation..." "Yellow"

        $scriptPath = $MyInvocation.PSCommandPath
        if (-not $scriptPath) {
            $tempScript = "$env:TEMP\uninstall-it-dashboard-agent.ps1"
            $scriptContent = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.ps1" -UseBasicParsing).Content
            Set-Content -Path $tempScript -Value $scriptContent -Encoding UTF8
            $scriptPath = $tempScript
        }

        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
        if ($InstallPath -ne "$env:ProgramData\it-dashboard-agent") {
            $arguments += " -InstallPath `"$InstallPath`""
        }
        if ($KeepConfig) { $arguments += " -KeepConfig" }
        if ($Force) { $arguments += " -Force" }

        Start-Process powershell -Verb RunAs -ArgumentList $arguments
        exit
    }
}

function Main {
    Write-Banner
    Request-Elevation

    # Check if installed
    $serviceExists = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    $pathExists = Test-Path $InstallPath

    if (-not $serviceExists -and -not $pathExists) {
        Write-ColorText "IT Dashboard Agent is not installed." "Yellow"
        Write-ColorText "  Service: Not found" "Gray"
        Write-ColorText "  Path: $InstallPath (not found)" "Gray"
        return
    }

    # Show what will be removed
    Write-ColorText "The following will be removed:" "Yellow"
    Write-Host ""

    if ($serviceExists) {
        Write-ColorText "  Service: $ServiceName ($($serviceExists.Status))" "White"
    }

    if ($pathExists) {
        Write-ColorText "  Directory: $InstallPath" "White"

        # Show config status
        if (Test-Path "$InstallPath\.env") {
            if ($KeepConfig) {
                Write-ColorText "  Config: Will be preserved (backup)" "Green"
            } else {
                Write-ColorText "  Config: Will be deleted" "Red"
            }
        }
    }

    Write-Host ""

    # Confirm unless -Force
    if (-not $Force) {
        $confirm = Read-Host "Are you sure you want to uninstall? [y/N]"
        if ($confirm -notmatch '^[Yy]') {
            Write-ColorText "Uninstall cancelled." "Yellow"
            return
        }
    }

    Write-Host ""

    # Backup config if requested
    $configBackup = $null
    if ($KeepConfig -and (Test-Path "$InstallPath\.env")) {
        Write-ColorText "Backing up configuration..." "Cyan"
        $configBackup = "$env:USERPROFILE\it-dashboard-agent.env.backup"
        Copy-Item "$InstallPath\.env" $configBackup -Force
        Write-ColorText "  Saved to: $configBackup" "Gray"
    }

    # Stop and remove service
    if ($serviceExists) {
        Write-ColorText "Stopping service..." "Cyan"

        $nssmPath = "$InstallPath\nssm.exe"
        if (Test-Path $nssmPath) {
            & $nssmPath stop $ServiceName 2>$null
            Start-Sleep -Seconds 2
            & $nssmPath remove $ServiceName confirm 2>$null
        } else {
            # Try with sc.exe as fallback
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            & sc.exe delete $ServiceName 2>$null
        }

        Write-ColorText "[OK] Service removed" "Green"
    }

    # Remove installation directory
    if ($pathExists) {
        Write-ColorText "Removing installation directory..." "Cyan"

        try {
            Remove-Item -Path $InstallPath -Recurse -Force
            Write-ColorText "[OK] Directory removed" "Green"
        } catch {
            Write-ColorText "[WARN] Could not fully remove directory: $_" "Yellow"
            Write-ColorText "  You may need to manually delete: $InstallPath" "Yellow"
        }
    }

    # Success message
    Write-Host ""
    Write-ColorText "========================================" "Green"
    Write-ColorText "  Uninstall Complete!" "Green"
    Write-ColorText "========================================" "Green"
    Write-Host ""

    if ($configBackup) {
        Write-ColorText "Configuration backed up to:" "Cyan"
        Write-ColorText "  $configBackup" "White"
        Write-Host ""
        Write-ColorText "To reinstall with previous config, restore the .env file after installation." "Yellow"
    }

    Write-ColorText "Thank you for using IT Dashboard Agent!" "Cyan"
    Write-Host ""
}

# Run main
Main
