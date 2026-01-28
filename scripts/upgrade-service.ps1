#Requires -Version 5.1
<#
.SYNOPSIS
    IT Dashboard Agent - Upgrade Service Script
.DESCRIPTION
    External PowerShell script that handles agent upgrades safely by:
    1. Stopping the NSSM service (releases file locks)
    2. Backing up current installation
    3. Downloading and extracting new version
    4. Installing dependencies and building
    5. Restoring configuration
    6. Restarting the service

    This script is spawned by the agent when an upgrade command is received.
    It runs externally so the agent process can exit and release file handles.
.PARAMETER DownloadUrl
    URL to download the agent ZIP from (GitHub archive)
.PARAMETER InstallPath
    Path where the agent is installed
.PARAMETER TargetVersion
    Target version string (for logging)
.NOTES
    Version: 1.0.0
    Author: Velocity EU
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DownloadUrl,

    [Parameter(Mandatory = $false)]
    [string]$InstallPath = "$env:ProgramData\it-dashboard-agent",

    [Parameter(Mandatory = $false)]
    [string]$TargetVersion = "latest"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Constants
$ServiceName = "ITDashboardAgent"
$NssmPath = Join-Path $InstallPath "nssm.exe"
$StatusFile = Join-Path $InstallPath "upgrade-status.json"
$LogFile = Join-Path $InstallPath "logs\upgrade.log"

# Ensure logs directory exists
$LogDir = Split-Path $LogFile -Parent
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine = "[$timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $logLine -Encoding UTF8

    switch ($Level) {
        "ERROR" { Write-Host $logLine -ForegroundColor Red }
        "WARN"  { Write-Host $logLine -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $logLine -ForegroundColor Green }
        default { Write-Host $logLine }
    }
}

function Write-Status {
    param(
        [string]$Status,
        [string]$Message,
        [string]$PreviousVersion = "",
        [string]$NewVersion = "",
        [string]$Error = ""
    )

    $statusObj = @{
        status = $Status
        message = $Message
        timestamp = (Get-Date -Format "o")
        previous_version = $PreviousVersion
        new_version = $NewVersion
        error = $Error
    }

    $statusObj | ConvertTo-Json | Set-Content -Path $StatusFile -Encoding UTF8
}

function Get-CurrentVersion {
    $pkgPath = Join-Path $InstallPath "package.json"
    if (Test-Path $pkgPath) {
        try {
            $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
            return $pkg.version
        } catch {
            return "0.0.0"
        }
    }
    return "0.0.0"
}

function Stop-AgentService {
    Write-Log "Stopping $ServiceName service..."

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Log "Service not found, skipping stop" "WARN"
        return $true
    }

    if ($service.Status -ne 'Running') {
        Write-Log "Service already stopped"
        return $true
    }

    try {
        # Use NSSM to stop if available
        if (Test-Path $NssmPath) {
            & $NssmPath stop $ServiceName 2>$null
        } else {
            Stop-Service -Name $ServiceName -Force
        }

        # Wait for service to stop (max 30 seconds)
        $timeout = 30
        $elapsed = 0
        while ($elapsed -lt $timeout) {
            $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
            if ($service.Status -eq 'Stopped') {
                Write-Log "Service stopped successfully"
                return $true
            }
            Start-Sleep -Seconds 1
            $elapsed++
        }

        Write-Log "Service did not stop within timeout" "WARN"
        return $false
    } catch {
        Write-Log "Failed to stop service: $_" "ERROR"
        return $false
    }
}

function Start-AgentService {
    Write-Log "Starting $ServiceName service..."

    # Check if service exists
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Log "Service not found - running in development mode (no service to start)" "WARN"
        return $true  # Not a failure in dev mode
    }

    try {
        if (Test-Path $NssmPath) {
            & $NssmPath start $ServiceName 2>$null
        } else {
            Start-Service -Name $ServiceName
        }

        # Wait for service to start (max 15 seconds)
        $timeout = 15
        $elapsed = 0
        while ($elapsed -lt $timeout) {
            $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
            if ($service -and $service.Status -eq 'Running') {
                Write-Log "Service started successfully" "SUCCESS"
                return $true
            }
            Start-Sleep -Seconds 1
            $elapsed++
        }

        Write-Log "Service did not start within timeout" "WARN"
        return $false
    } catch {
        Write-Log "Failed to start service: $_" "ERROR"
        return $false
    }
}

function Backup-Installation {
    param([string]$PreviousVersion)

    Write-Log "Creating backup of current installation..."

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path (Split-Path $InstallPath -Parent) "it-dashboard-agent-backup-$timestamp"

    try {
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

        # Backup essential files
        $itemsToBackup = @("dist", "package.json", "package-lock.json", ".env")

        foreach ($item in $itemsToBackup) {
            $sourcePath = Join-Path $InstallPath $item
            if (Test-Path $sourcePath) {
                $destPath = Join-Path $backupDir $item
                if ((Get-Item $sourcePath).PSIsContainer) {
                    Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force
                } else {
                    Copy-Item -Path $sourcePath -Destination $destPath -Force
                }
            }
        }

        Write-Log "Backup created at: $backupDir"
        return $backupDir
    } catch {
        Write-Log "Failed to create backup: $_" "ERROR"
        return $null
    }
}

function Restore-Backup {
    param([string]$BackupDir)

    Write-Log "Restoring from backup: $BackupDir"

    try {
        $itemsToRestore = @("dist", "package.json", "package-lock.json")

        foreach ($item in $itemsToRestore) {
            $sourcePath = Join-Path $BackupDir $item
            $destPath = Join-Path $InstallPath $item

            if (Test-Path $sourcePath) {
                # Remove current
                if (Test-Path $destPath) {
                    Remove-Item -Path $destPath -Recurse -Force
                }

                # Restore
                if ((Get-Item $sourcePath).PSIsContainer) {
                    Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force
                } else {
                    Copy-Item -Path $sourcePath -Destination $destPath -Force
                }
            }
        }

        Write-Log "Backup restored successfully" "SUCCESS"
        return $true
    } catch {
        Write-Log "Failed to restore backup: $_" "ERROR"
        return $false
    }
}

function Download-NewVersion {
    Write-Log "Downloading new version from: $DownloadUrl"

    $tempDir = Join-Path $env:TEMP "it-dashboard-agent-upgrade"
    $zipPath = Join-Path $tempDir "agent-upgrade.zip"

    # Clean temp dir
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        # Download with retry
        $maxRetries = 3
        $retryDelay = 5

        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            try {
                Write-Log "Download attempt $attempt/$maxRetries..."
                Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 120

                # Verify download
                if ((Get-Item $zipPath).Length -lt 10000) {
                    throw "Downloaded file too small"
                }

                Write-Log "Download successful"
                return $zipPath
            } catch {
                Write-Log "Download attempt $attempt failed: $_" "WARN"
                if ($attempt -lt $maxRetries) {
                    Start-Sleep -Seconds $retryDelay
                }
            }
        }

        throw "Failed to download after $maxRetries attempts"
    } catch {
        Write-Log "Download failed: $_" "ERROR"
        return $null
    }
}

function Extract-Archive {
    param([string]$ZipPath)

    Write-Log "Extracting archive..."

    $extractPath = Join-Path (Split-Path $ZipPath -Parent) "extracted"

    try {
        if (Test-Path $extractPath) {
            Remove-Item -Path $extractPath -Recurse -Force
        }

        Expand-Archive -Path $ZipPath -DestinationPath $extractPath -Force

        # Find the extracted folder (GitHub adds repo-branch prefix)
        $extractedFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1

        if ($extractedFolder) {
            Write-Log "Extracted to: $($extractedFolder.FullName)"
            return $extractedFolder.FullName
        }

        return $extractPath
    } catch {
        Write-Log "Extraction failed: $_" "ERROR"
        return $null
    }
}

function Install-Dependencies {
    param([string]$SourcePath)

    Write-Log "Installing dependencies..."

    try {
        Push-Location $SourcePath

        # Check if pre-built (has dist/index.js and node_modules)
        $distIndex = Join-Path $SourcePath "dist\index.js"
        $nodeModules = Join-Path $SourcePath "node_modules"

        if ((Test-Path $distIndex) -and (Test-Path $nodeModules)) {
            Write-Log "Pre-built release detected, skipping npm install"
            Pop-Location
            return $true
        }

        # Check if only dist exists
        if (Test-Path $distIndex) {
            Write-Log "Pre-built dist detected, running npm install --production"
            $output = & npm install --production 2>&1
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed: $output"
            }
            Pop-Location
            return $true
        }

        # Full build required
        Write-Log "Running npm install..."
        $output = & npm install 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed: $output"
        }

        Write-Log "Running npm run build..."
        $output = & npm run build 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed: $output"
        }

        Pop-Location
        Write-Log "Build completed successfully"
        return $true
    } catch {
        Pop-Location
        Write-Log "Build failed: $_" "ERROR"
        return $false
    }
}

function Swap-Files {
    param([string]$SourcePath)

    Write-Log "Swapping files..."

    try {
        # Files/folders to replace
        $itemsToReplace = @("dist", "package.json", "package-lock.json", "src", "scripts")

        foreach ($item in $itemsToReplace) {
            $sourcePath = Join-Path $SourcePath $item
            $destPath = Join-Path $InstallPath $item

            if (-not (Test-Path $sourcePath)) {
                continue
            }

            # Remove old
            if (Test-Path $destPath) {
                Remove-Item -Path $destPath -Recurse -Force
            }

            # Copy new
            if ((Get-Item $sourcePath).PSIsContainer) {
                Copy-Item -Path $sourcePath -Destination $destPath -Recurse -Force
            } else {
                Copy-Item -Path $sourcePath -Destination $destPath -Force
            }
        }

        Write-Log "Files swapped successfully"
        return $true
    } catch {
        Write-Log "File swap failed: $_" "ERROR"
        return $false
    }
}

function Verify-Build {
    param([string]$SourcePath)

    Write-Log "Verifying build..."

    $distIndex = Join-Path $SourcePath "dist\index.js"
    $pkgJson = Join-Path $SourcePath "package.json"

    if (-not (Test-Path $distIndex)) {
        Write-Log "dist/index.js not found" "ERROR"
        return $false
    }

    if (-not (Test-Path $pkgJson)) {
        Write-Log "package.json not found" "ERROR"
        return $false
    }

    Write-Log "Build verification passed"
    return $true
}

function Cleanup-Temp {
    param([string]$TempDir)

    Write-Log "Cleaning up temporary files..."

    try {
        if ($TempDir -and (Test-Path $TempDir)) {
            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Log "Cleanup warning: $_" "WARN"
    }
}

# Main upgrade process
function Main {
    Write-Log "========================================"
    Write-Log "IT Dashboard Agent Upgrade Script"
    Write-Log "========================================"
    Write-Log "Install Path: $InstallPath"
    Write-Log "Download URL: $DownloadUrl"
    Write-Log "Target Version: $TargetVersion"
    Write-Log ""

    $previousVersion = Get-CurrentVersion
    Write-Log "Current version: $previousVersion"

    Write-Status -Status "starting" -Message "Starting upgrade process" -PreviousVersion $previousVersion

    $backupDir = $null
    $tempDir = $null

    try {
        # Step 1: Stop service
        Write-Status -Status "stopping" -Message "Stopping agent service" -PreviousVersion $previousVersion
        if (-not (Stop-AgentService)) {
            # Continue anyway - service might not be running
            Write-Log "Continuing despite service stop issue" "WARN"
        }

        # Wait a bit for file handles to be released
        Start-Sleep -Seconds 2

        # Step 2: Backup
        Write-Status -Status "backup" -Message "Creating backup" -PreviousVersion $previousVersion
        $backupDir = Backup-Installation -PreviousVersion $previousVersion
        if (-not $backupDir) {
            throw "Backup failed"
        }

        # Step 3: Download
        Write-Status -Status "downloading" -Message "Downloading new version" -PreviousVersion $previousVersion
        $zipPath = Download-NewVersion
        if (-not $zipPath) {
            throw "Download failed"
        }
        $tempDir = Split-Path $zipPath -Parent

        # Step 4: Extract
        Write-Status -Status "extracting" -Message "Extracting archive" -PreviousVersion $previousVersion
        $extractPath = Extract-Archive -ZipPath $zipPath
        if (-not $extractPath) {
            throw "Extraction failed"
        }

        # Step 5: Build
        Write-Status -Status "building" -Message "Installing dependencies and building" -PreviousVersion $previousVersion
        if (-not (Install-Dependencies -SourcePath $extractPath)) {
            throw "Build failed"
        }

        # Step 6: Verify
        Write-Status -Status "verifying" -Message "Verifying build" -PreviousVersion $previousVersion
        if (-not (Verify-Build -SourcePath $extractPath)) {
            throw "Verification failed"
        }

        # Step 7: Swap files
        Write-Status -Status "installing" -Message "Installing new version" -PreviousVersion $previousVersion
        if (-not (Swap-Files -SourcePath $extractPath)) {
            throw "File swap failed"
        }

        # Step 8: Cleanup temp
        Cleanup-Temp -TempDir $tempDir

        # Get new version
        $newVersion = Get-CurrentVersion
        Write-Log "New version: $newVersion" "SUCCESS"

        # Step 9: Start service
        Write-Status -Status "starting" -Message "Starting agent service" -PreviousVersion $previousVersion -NewVersion $newVersion
        if (-not (Start-AgentService)) {
            throw "Failed to start service after upgrade"
        }

        # Success!
        Write-Status -Status "completed" -Message "Upgrade completed successfully" -PreviousVersion $previousVersion -NewVersion $newVersion
        Write-Log "========================================"
        Write-Log "UPGRADE COMPLETE: $previousVersion -> $newVersion" "SUCCESS"
        Write-Log "========================================"

        # Clean up old backup after successful upgrade (keep for 1 hour for manual rollback)
        # For now, we'll leave the backup in place

        exit 0

    } catch {
        $errorMsg = $_.Exception.Message
        Write-Log "UPGRADE FAILED: $errorMsg" "ERROR"

        Write-Status -Status "failed" -Message "Upgrade failed" -PreviousVersion $previousVersion -Error $errorMsg

        # Attempt rollback
        if ($backupDir -and (Test-Path $backupDir)) {
            Write-Log "Attempting rollback..."
            if (Restore-Backup -BackupDir $backupDir) {
                Write-Log "Rollback successful" "SUCCESS"
                Write-Status -Status "rolled_back" -Message "Upgrade failed, rolled back to previous version" -PreviousVersion $previousVersion -Error $errorMsg
            } else {
                Write-Log "Rollback also failed!" "ERROR"
                Write-Status -Status "failed_no_rollback" -Message "Upgrade and rollback both failed" -PreviousVersion $previousVersion -Error $errorMsg
            }
        }

        # Try to restart service with old version
        Start-AgentService

        # Cleanup temp
        if ($tempDir) {
            Cleanup-Temp -TempDir $tempDir
        }

        exit 1
    }
}

# Run
Main
