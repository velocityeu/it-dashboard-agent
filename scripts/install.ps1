#Requires -Version 5.1
<#
.SYNOPSIS
    IT Dashboard Agent - Windows Installer
.DESCRIPTION
    One-line installer for IT Dashboard Agent on Windows.
    Downloads, configures, and registers the agent as a Windows service.
.EXAMPLE
    irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.ps1 | iex
.NOTES
    Version: 1.0.0
    Author: Velocity EU
#>

[CmdletBinding()]
param(
    [string]$InstallPath = "$env:ProgramData\it-dashboard-agent",
    [string]$DashboardUrl,
    [string]$ApiKey,
    [string]$AgentName,
    [switch]$Unattended
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Version and constants
$Version = "1.0.0"
$RepoUrl = "https://github.com/velocityeu/it-dashboard-agent.git"
$NssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
$NssmPath = "$InstallPath\nssm.exe"
$ServiceName = "ITDashboardAgent"
$DefaultDashboardUrl = "https://it-dashboard-gray.vercel.app"

# Colors
function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Write-Banner {
    Clear-Host
    Write-ColorText @"

  _____ _____   ____            _     _                         _
 |_   _|_   _| |  _ \  __ _ ___| |__ | |__   ___   __ _ _ __ __| |
   | |   | |   | | | |/ _` / __| '_ \| '_ \ / _ \ / _` | '__/ _` |
   | |   | |   | |_| | (_| \__ \ | | | |_) | (_) | (_| | | | (_| |
  _|_|_ _|_|_  |____/ \__,_|___/_| |_|_.__/ \___/ \__,_|_|  \__,_|
 |  ___|_   _|     / \   __ _  ___ _ __ | |_
 | |_    | |      / _ \ / _` |/ _ \ '_ \| __|
 |  _|   | |     / ___ \ (_| |  __/ | | | |_
 |_|     |_|    /_/   \_\__, |\___|_| |_|\__|
                        |___/
                                                 v$Version - Windows

"@ "Cyan"
}

function Write-Step {
    param([int]$Step, [int]$Total, [string]$Message)
    Write-ColorText "[$Step/$Total] $Message" "Yellow"
}

function Write-Success {
    param([string]$Message)
    Write-ColorText "[OK] $Message" "Green"
}

function Write-Error2 {
    param([string]$Message)
    Write-ColorText "[ERROR] $Message" "Red"
}

function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Request-Elevation {
    if (-not (Test-Administrator)) {
        Write-ColorText "This installer requires Administrator privileges." "Yellow"
        Write-ColorText "Restarting with elevation..." "Yellow"

        # Build arguments for elevated process
        $scriptPath = $MyInvocation.PSCommandPath
        if (-not $scriptPath) {
            # Running from IEX, save script to temp and run
            $tempScript = "$env:TEMP\install-it-dashboard-agent.ps1"
            $scriptContent = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.ps1" -UseBasicParsing).Content
            Set-Content -Path $tempScript -Value $scriptContent -Encoding UTF8
            $scriptPath = $tempScript
        }

        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
        if ($InstallPath -ne "$env:ProgramData\it-dashboard-agent") {
            $arguments += " -InstallPath `"$InstallPath`""
        }
        if ($DashboardUrl) { $arguments += " -DashboardUrl `"$DashboardUrl`"" }
        if ($ApiKey) { $arguments += " -ApiKey `"$ApiKey`"" }
        if ($AgentName) { $arguments += " -AgentName `"$AgentName`"" }
        if ($Unattended) { $arguments += " -Unattended" }

        Start-Process powershell -Verb RunAs -ArgumentList $arguments
        exit
    }
}

function Test-NodeJS {
    try {
        $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCmd) { return $false }

        $versionStr = & node --version 2>$null
        if (-not $versionStr) { return $false }

        $majorVersion = [int]($versionStr -replace 'v(\d+)\..*', '$1')
        return $majorVersion -ge 18
    } catch {
        return $false
    }
}

function Install-NodeJS {
    Write-ColorText "Node.js 18+ not found. Installing..." "Yellow"

    # Try WinGet first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-ColorText "Installing Node.js via WinGet..." "Cyan"
        try {
            & winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent

            # Refresh PATH
            $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

            if (Test-NodeJS) {
                Write-Success "Node.js installed via WinGet"
                return $true
            }
        } catch {
            Write-ColorText "WinGet installation failed, trying direct download..." "Yellow"
        }
    }

    # Fallback: Direct MSI download
    Write-ColorText "Downloading Node.js installer..." "Cyan"
    $nodeVersion = "20.11.0"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $msiUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-$arch.msi"
    $msiPath = "$env:TEMP\nodejs-installer.msi"

    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing

        Write-ColorText "Installing Node.js (this may take a minute)..." "Cyan"
        $process = Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru

        if ($process.ExitCode -ne 0) {
            throw "MSI installation failed with exit code: $($process.ExitCode)"
        }

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

        # Remove temp file
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

        if (Test-NodeJS) {
            Write-Success "Node.js installed successfully"
            return $true
        } else {
            throw "Node.js installation completed but node command not found"
        }
    } catch {
        Write-Error2 "Failed to install Node.js: $_"
        Write-ColorText "Please install Node.js 18+ manually from https://nodejs.org" "Yellow"
        return $false
    }
}

function Install-NSSM {
    if (Test-Path $NssmPath) {
        return $true
    }

    Write-ColorText "Downloading NSSM (service manager)..." "Cyan"
    $zipPath = "$env:TEMP\nssm.zip"
    $extractPath = "$env:TEMP\nssm-extract"

    try {
        Invoke-WebRequest -Uri $NssmUrl -OutFile $zipPath -UseBasicParsing

        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        # Find nssm.exe (64-bit preferred)
        $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
        $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" |
                   Where-Object { $_.DirectoryName -like "*$arch*" } |
                   Select-Object -First 1

        if (-not $nssmExe) {
            $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" | Select-Object -First 1
        }

        if (-not $nssmExe) {
            throw "Could not find nssm.exe in downloaded archive"
        }

        Copy-Item -Path $nssmExe.FullName -Destination $NssmPath -Force

        # Cleanup
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue

        Write-Success "NSSM installed"
        return $true
    } catch {
        Write-Error2 "Failed to install NSSM: $_"
        return $false
    }
}

function Get-Configuration {
    Write-ColorText "`nConfiguration" "Cyan"
    Write-ColorText "=============" "Cyan"

    # Dashboard URL
    if (-not $script:DashboardUrl) {
        $input = Read-Host "Dashboard URL [$DefaultDashboardUrl]"
        $script:DashboardUrl = if ($input) { $input } else { $DefaultDashboardUrl }
    }

    # API Key
    if (-not $script:ApiKey) {
        $secureKey = Read-Host "Agent API Key" -AsSecureString
        $script:ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        )

        if (-not $script:ApiKey) {
            Write-Error2 "API Key is required"
            return $false
        }
    }

    # Agent Name
    if (-not $script:AgentName) {
        $defaultName = "$env:COMPUTERNAME Agent"
        $input = Read-Host "Agent Name [$defaultName]"
        $script:AgentName = if ($input) { $input } else { $defaultName }
    }

    Write-Host ""
    return $true
}

function Test-ExistingInstall {
    if (Test-Path $InstallPath) {
        Write-ColorText "`nExisting installation detected at: $InstallPath" "Yellow"

        # Check if service exists
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($service) {
            Write-ColorText "Service '$ServiceName' is $($service.Status)" "Yellow"
        }

        Write-Host ""
        Write-ColorText "Options:" "Cyan"
        Write-ColorText "  [U] Upgrade - Pull latest code and restart service" "White"
        Write-ColorText "  [R] Reconfigure - Update configuration only" "White"
        Write-ColorText "  [F] Fresh install - Remove and reinstall" "White"
        Write-ColorText "  [C] Cancel" "White"
        Write-Host ""

        $choice = Read-Host "Select option [U/R/F/C]"

        switch ($choice.ToUpper()) {
            'U' { return 'Upgrade' }
            'R' { return 'Reconfigure' }
            'F' { return 'Fresh' }
            default { return 'Cancel' }
        }
    }

    return 'NewInstall'
}

function Stop-ExistingService {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Write-ColorText "Stopping existing service..." "Yellow"
        & $NssmPath stop $ServiceName 2>$null
        Start-Sleep -Seconds 2
    }
}

function Remove-ExistingInstall {
    Stop-ExistingService

    # Remove service
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        Write-ColorText "Removing existing service..." "Yellow"
        & $NssmPath remove $ServiceName confirm 2>$null
    }

    # Remove directory
    if (Test-Path $InstallPath) {
        Write-ColorText "Removing existing installation..." "Yellow"
        Remove-Item -Path $InstallPath -Recurse -Force
    }
}

function Clone-Repository {
    Write-ColorText "Cloning repository..." "Cyan"

    # Check if git is available
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Error2 "Git is not installed. Please install Git and try again."
        Write-ColorText "Download from: https://git-scm.com/download/win" "Yellow"
        return $false
    }

    try {
        # Create parent directory if needed
        $parentPath = Split-Path $InstallPath -Parent
        if (-not (Test-Path $parentPath)) {
            New-Item -ItemType Directory -Path $parentPath -Force | Out-Null
        }

        # Clone repository and capture output
        $cloneOutput = & git clone --depth 1 $RepoUrl $InstallPath 2>&1
        $cloneExitCode = $LASTEXITCODE

        if ($cloneExitCode -ne 0) {
            throw "Git clone failed: $cloneOutput"
        }

        if (-not (Test-Path "$InstallPath\package.json")) {
            throw "Clone succeeded but package.json not found"
        }

        Write-Success "Repository cloned"
        return $true
    } catch {
        Write-Error2 "Failed to clone repository: $_"
        return $false
    }
}

function Update-Repository {
    Write-ColorText "Pulling latest changes..." "Cyan"

    try {
        Push-Location $InstallPath
        & git fetch --depth 1 origin master 2>&1 | Out-Null
        & git reset --hard origin/master 2>&1 | Out-Null
        Pop-Location

        Write-Success "Repository updated"
        return $true
    } catch {
        Pop-Location
        Write-Error2 "Failed to update repository: $_"
        return $false
    }
}

function Install-Dependencies {
    Write-ColorText "Installing dependencies..." "Cyan"

    try {
        Push-Location $InstallPath

        # Use npm ci for clean install
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npmCmd) {
            throw "npm not found in PATH"
        }

        & npm ci --production 2>&1 | Out-Null

        Pop-Location
        Write-Success "Dependencies installed"
        return $true
    } catch {
        Pop-Location
        Write-Error2 "Failed to install dependencies: $_"
        return $false
    }
}

function Build-Agent {
    Write-ColorText "Building agent..." "Cyan"

    try {
        Push-Location $InstallPath

        # Need dev dependencies for build
        & npm install 2>&1 | Out-Null
        & npm run build 2>&1 | Out-Null

        if (-not (Test-Path "$InstallPath\dist\index.js")) {
            throw "Build completed but dist/index.js not found"
        }

        Pop-Location
        Write-Success "Agent built"
        return $true
    } catch {
        Pop-Location
        Write-Error2 "Failed to build agent: $_"
        return $false
    }
}

function Write-EnvFile {
    Write-ColorText "Creating configuration file..." "Cyan"

    $envPath = "$InstallPath\.env"
    $envContent = @"
# IT Dashboard Agent Configuration
# Generated by installer on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

DASHBOARD_URL=$script:DashboardUrl
AGENT_API_KEY=$script:ApiKey
AGENT_NAME=$script:AgentName

# Optional settings
HEARTBEAT_INTERVAL=60000
STATUS_CHECK_INTERVAL=30000
LOG_LEVEL=info
"@

    try {
        Set-Content -Path $envPath -Value $envContent -Encoding UTF8

        # Set ACL to restrict access
        $acl = Get-Acl $envPath
        $acl.SetAccessRuleProtection($true, $false)

        # SYSTEM - Full Control
        $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "NT AUTHORITY\SYSTEM", "FullControl", "Allow"
        )
        $acl.AddAccessRule($systemRule)

        # Administrators - Full Control
        $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "BUILTIN\Administrators", "FullControl", "Allow"
        )
        $acl.AddAccessRule($adminRule)

        Set-Acl -Path $envPath -AclObject $acl

        Write-Success "Configuration file created with restricted permissions"
        return $true
    } catch {
        Write-Error2 "Failed to create configuration file: $_"
        return $false
    }
}

function Register-Service {
    Write-ColorText "Registering Windows service..." "Cyan"

    try {
        # Get node path
        $nodePath = (Get-Command node).Source
        $scriptPath = "$InstallPath\dist\index.js"

        # Remove existing service if present
        $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($existingService) {
            & $NssmPath remove $ServiceName confirm 2>$null
            Start-Sleep -Seconds 1
        }

        # Install service
        & $NssmPath install $ServiceName $nodePath $scriptPath
        & $NssmPath set $ServiceName AppDirectory $InstallPath
        & $NssmPath set $ServiceName DisplayName "IT Dashboard Agent"
        & $NssmPath set $ServiceName Description "Local network monitoring agent for IT Dashboard"
        & $NssmPath set $ServiceName Start SERVICE_AUTO_START
        & $NssmPath set $ServiceName AppStdout "$InstallPath\logs\service.log"
        & $NssmPath set $ServiceName AppStderr "$InstallPath\logs\service-error.log"
        & $NssmPath set $ServiceName AppRotateFiles 1
        & $NssmPath set $ServiceName AppRotateBytes 1048576

        # Create logs directory
        New-Item -ItemType Directory -Path "$InstallPath\logs" -Force | Out-Null

        Write-Success "Service registered"
        return $true
    } catch {
        Write-Error2 "Failed to register service: $_"
        return $false
    }
}

function Start-AgentService {
    Write-ColorText "Starting service..." "Cyan"

    try {
        & $NssmPath start $ServiceName
        Start-Sleep -Seconds 3

        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($service -and $service.Status -eq 'Running') {
            Write-Success "Service started"
            return $true
        } else {
            throw "Service did not start properly"
        }
    } catch {
        Write-Error2 "Failed to start service: $_"
        Write-ColorText "Check logs at: $InstallPath\logs\" "Yellow"
        return $false
    }
}

function Show-Completion {
    Write-Host ""
    Write-ColorText "========================================" "Green"
    Write-ColorText "  Installation Complete!" "Green"
    Write-ColorText "========================================" "Green"
    Write-Host ""
    Write-ColorText "Agent UI:    http://localhost:3001" "Cyan"
    Write-ColorText "Service:     $ServiceName (running)" "Cyan"
    Write-ColorText "Install Dir: $InstallPath" "Cyan"
    Write-ColorText "Logs:        $InstallPath\logs\" "Cyan"
    Write-Host ""
    Write-ColorText "Useful commands:" "Yellow"
    Write-ColorText "  Start:   nssm start $ServiceName" "White"
    Write-ColorText "  Stop:    nssm stop $ServiceName" "White"
    Write-ColorText "  Status:  nssm status $ServiceName" "White"
    Write-ColorText "  Logs:    Get-Content $InstallPath\logs\service.log -Tail 50" "White"
    Write-Host ""
    Write-ColorText "To uninstall, run:" "Yellow"
    Write-ColorText "  irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/uninstall.ps1 | iex" "White"
    Write-Host ""
}

# Main installation flow
function Main {
    Write-Banner
    Request-Elevation

    $totalSteps = 7
    $currentStep = 0

    # Check for existing installation
    $installMode = Test-ExistingInstall

    switch ($installMode) {
        'Cancel' {
            Write-ColorText "Installation cancelled." "Yellow"
            return
        }
        'Reconfigure' {
            if (-not (Get-Configuration)) { return }
            if (-not (Write-EnvFile)) { return }

            # Restart service
            Stop-ExistingService
            Start-AgentService
            Show-Completion
            return
        }
        'Fresh' {
            Remove-ExistingInstall
        }
        'Upgrade' {
            # Will do git pull instead of clone
        }
    }

    # Step 1: Check Node.js
    $currentStep++
    Write-Step $currentStep $totalSteps "Checking Node.js..."
    if (Test-NodeJS) {
        $nodeVersion = & node --version
        Write-Success "Node.js $nodeVersion found"
    } else {
        if (-not (Install-NodeJS)) {
            Write-Error2 "Cannot continue without Node.js 18+"
            return
        }
    }

    # Step 2: Clone or update repository
    $currentStep++
    if ($installMode -eq 'Upgrade') {
        Write-Step $currentStep $totalSteps "Updating repository..."
        if (-not (Update-Repository)) { return }
    } else {
        Write-Step $currentStep $totalSteps "Cloning repository..."
        if (-not (Clone-Repository)) { return }
    }

    # Step 3: Get configuration (only for new installs)
    $currentStep++
    Write-Step $currentStep $totalSteps "Configuring agent..."
    if ($installMode -ne 'Upgrade' -or -not (Test-Path "$InstallPath\.env")) {
        if (-not (Get-Configuration)) { return }
    } else {
        Write-Success "Using existing configuration"
    }

    # Step 4: Install dependencies
    $currentStep++
    Write-Step $currentStep $totalSteps "Installing dependencies..."
    if (-not (Install-Dependencies)) { return }

    # Step 5: Build agent
    $currentStep++
    Write-Step $currentStep $totalSteps "Building agent..."
    if (-not (Build-Agent)) { return }

    # Step 6: Write config (only for new installs)
    if ($installMode -ne 'Upgrade') {
        if (-not (Write-EnvFile)) { return }
    }

    # Step 7: Install NSSM and register service
    $currentStep++
    Write-Step $currentStep $totalSteps "Setting up Windows service..."
    if (-not (Install-NSSM)) { return }
    if (-not (Register-Service)) { return }

    # Step 8: Start service
    $currentStep++
    Write-Step $currentStep $totalSteps "Starting service..."
    if (-not (Start-AgentService)) { return }

    Show-Completion
}

# Run main
Main
