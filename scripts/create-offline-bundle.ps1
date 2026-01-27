#Requires -Version 5.1
<#
.SYNOPSIS
    Create offline installation bundle for IT Dashboard Agent
.DESCRIPTION
    Creates a self-contained ZIP file with all dependencies for air-gapped installations.
    The bundle includes node_modules, compiled dist, NSSM binary, and installer scripts.
.PARAMETER OutputPath
    Path where the bundle ZIP will be created. Defaults to current directory.
.PARAMETER IncludeNodeJs
    Include Node.js installer in the bundle for systems without Node.js.
.EXAMPLE
    .\create-offline-bundle.ps1
    Creates bundle in current directory
.EXAMPLE
    .\create-offline-bundle.ps1 -OutputPath "C:\Bundles" -IncludeNodeJs
    Creates bundle with Node.js installer included
#>

[CmdletBinding()]
param(
    [string]$OutputPath = ".",
    [switch]$IncludeNodeJs
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Get script directory (project root is parent)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Get-ProjectVersion {
    $pkgPath = Join-Path $ProjectRoot "package.json"
    if (Test-Path $pkgPath) {
        $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
        return $pkg.version
    }
    return "0.0.0"
}

Write-ColorText @"

  ___  __  __ _ _              ____                  _ _
 / _ \/ _|/ _| (_)_ __   ___  | __ ) _   _ _ __   __| | | ___
| | | | |_| |_| | | '_ \ / _ \ |  _ \| | | | '_ \ / _` | |/ _ \
| |_| |  _|  _| | | | | |  __/ | |_) | |_| | | | | (_| | |  __/
 \___/|_| |_| |_|_|_| |_|\___| |____/ \__,_|_| |_|\__,_|_|\___|
                                                    IT Dashboard Agent

"@ "Cyan"

$version = Get-ProjectVersion
Write-ColorText "Creating offline bundle for v$version" "Yellow"
Write-Host ""

# Check we're in project root
if (-not (Test-Path (Join-Path $ProjectRoot "package.json"))) {
    Write-ColorText "Error: Must run from project root or scripts directory" "Red"
    exit 1
}

# Ensure output directory exists
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
}

$bundleName = "it-dashboard-agent-$version-offline"
$bundleDir = Join-Path $env:TEMP $bundleName
$outputZip = Join-Path $OutputPath "$bundleName.zip"

# Clean up any existing bundle directory
if (Test-Path $bundleDir) {
    Remove-Item $bundleDir -Recurse -Force
}
New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

Write-ColorText "[1/6] Building project..." "Cyan"
Push-Location $ProjectRoot
try {
    # Ensure dependencies are installed
    if (-not (Test-Path "node_modules")) {
        Write-ColorText "  Installing dependencies..." "Gray"
        & npm ci 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            & npm install 2>&1 | Out-Null
        }
    }

    # Build
    Write-ColorText "  Compiling TypeScript..." "Gray"
    & npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed"
    }
} finally {
    Pop-Location
}
Write-ColorText "  Build complete" "Green"

Write-ColorText "[2/6] Copying files..." "Cyan"
# Copy essential directories and files
$items = @(
    @{ Source = "dist"; Dest = "dist" },
    @{ Source = "node_modules"; Dest = "node_modules" },
    @{ Source = "scripts"; Dest = "scripts" },
    @{ Source = "bin"; Dest = "bin" },
    @{ Source = "package.json"; Dest = "package.json" },
    @{ Source = "package-lock.json"; Dest = "package-lock.json" }
)

foreach ($item in $items) {
    $sourcePath = Join-Path $ProjectRoot $item.Source
    $destPath = Join-Path $bundleDir $item.Dest

    if (Test-Path $sourcePath) {
        if ((Get-Item $sourcePath).PSIsContainer) {
            Write-ColorText "  Copying $($item.Source)/" "Gray"
            Copy-Item $sourcePath $destPath -Recurse
        } else {
            Write-ColorText "  Copying $($item.Source)" "Gray"
            Copy-Item $sourcePath $destPath
        }
    }
}

Write-ColorText "[3/6] Ensuring NSSM is bundled..." "Cyan"
$nssmPath = Join-Path $bundleDir "bin\windows\nssm.exe"
$nssmDir = Split-Path $nssmPath -Parent

if (-not (Test-Path $nssmDir)) {
    New-Item -ItemType Directory -Path $nssmDir -Force | Out-Null
}

if (-not (Test-Path $nssmPath)) {
    Write-ColorText "  Downloading NSSM..." "Gray"
    $zipPath = Join-Path $env:TEMP "nssm-offline.zip"
    $extractPath = Join-Path $env:TEMP "nssm-offline-extract"

    try {
        Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zipPath -UseBasicParsing -TimeoutSec 60
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" |
                   Where-Object { $_.DirectoryName -like "*win64*" } |
                   Select-Object -First 1

        if ($nssmExe) {
            Copy-Item $nssmExe.FullName $nssmPath
        } else {
            throw "Could not find nssm.exe"
        }
    } finally {
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-ColorText "  NSSM bundled" "Green"

Write-ColorText "[4/6] Creating offline installer..." "Cyan"
$offlineInstaller = @'
#Requires -Version 5.1
<#
.SYNOPSIS
    Offline installer for IT Dashboard Agent
.DESCRIPTION
    Installs the IT Dashboard Agent from a pre-built offline bundle.
    No internet connection required.
#>

[CmdletBinding()]
param(
    [string]$InstallPath = "$env:ProgramData\it-dashboard-agent",
    [string]$DashboardUrl,
    [string]$ApiKey,
    [string]$AgentName
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "IT Dashboard Agent - Offline Installer" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check admin
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Error: Administrator privileges required" -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator" -ForegroundColor Yellow
    exit 1
}

# Copy files
Write-Host "Installing to: $InstallPath" -ForegroundColor Yellow
if (Test-Path $InstallPath) {
    Write-Host "Removing existing installation..." -ForegroundColor Yellow
    Remove-Item $InstallPath -Recurse -Force
}

Write-Host "Copying files..." -ForegroundColor Cyan
Copy-Item $ScriptDir $InstallPath -Recurse

# Now run the regular installer with -Offline flag
$installerPath = Join-Path $InstallPath "scripts\install.ps1"
$args = @("-InstallPath", $InstallPath, "-Offline")
if ($DashboardUrl) { $args += @("-DashboardUrl", $DashboardUrl) }
if ($ApiKey) { $args += @("-ApiKey", $ApiKey) }
if ($AgentName) { $args += @("-AgentName", $AgentName) }

& $installerPath @args
'@

$offlineInstallerPath = Join-Path $bundleDir "install-offline.ps1"
Set-Content -Path $offlineInstallerPath -Value $offlineInstaller -Encoding UTF8
Write-ColorText "  Offline installer created" "Green"

if ($IncludeNodeJs) {
    Write-ColorText "[5/6] Downloading Node.js installer..." "Cyan"
    $nodeVersion = "20.11.0"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-$arch.msi"
    $nodePath = Join-Path $bundleDir "nodejs-$nodeVersion-$arch.msi"

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodePath -UseBasicParsing
        Write-ColorText "  Node.js $nodeVersion included" "Green"
    } catch {
        Write-ColorText "  Warning: Could not download Node.js installer" "Yellow"
    }
} else {
    Write-ColorText "[5/6] Skipping Node.js (use -IncludeNodeJs to include)" "Gray"
}

Write-ColorText "[6/6] Creating ZIP archive..." "Cyan"
if (Test-Path $outputZip) {
    Remove-Item $outputZip -Force
}
Compress-Archive -Path $bundleDir -DestinationPath $outputZip -CompressionLevel Optimal

# Calculate size and hash
$zipInfo = Get-Item $outputZip
$sizeMB = [math]::Round($zipInfo.Length / 1MB, 2)
$hash = (Get-FileHash $outputZip -Algorithm SHA256).Hash

# Clean up
Remove-Item $bundleDir -Recurse -Force

Write-Host ""
Write-ColorText "========================================" "Green"
Write-ColorText "  Offline bundle created successfully!" "Green"
Write-ColorText "========================================" "Green"
Write-Host ""
Write-ColorText "Output:   $outputZip" "Cyan"
Write-ColorText "Size:     $sizeMB MB" "Cyan"
Write-ColorText "SHA256:   $hash" "Cyan"
Write-Host ""
Write-ColorText "To install on an air-gapped system:" "Yellow"
Write-ColorText "  1. Copy the ZIP to the target machine" "White"
Write-ColorText "  2. Extract to any folder" "White"
Write-ColorText "  3. Run: .\install-offline.ps1" "White"
Write-Host ""
