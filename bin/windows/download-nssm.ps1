$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $scriptDir 'nssm.zip'
$extractPath = Join-Path $scriptDir 'nssm-extract'
$targetPath = Join-Path $scriptDir 'nssm.exe'

Write-Host 'Downloading NSSM...'
$urls = @(
    'https://nssm.cc/release/nssm-2.24.zip',
    'https://web.archive.org/web/20230806122308/https://nssm.cc/release/nssm-2.24.zip'
)

$downloaded = $false
foreach ($url in $urls) {
    try {
        Write-Host "Trying: $url"
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 60
        $downloaded = $true
        break
    } catch {
        Write-Host "Failed: $_"
    }
}

if (-not $downloaded) {
    throw 'Could not download NSSM from any mirror'
}

Write-Host 'Extracting...'
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

$nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter 'nssm.exe' |
           Where-Object { $_.DirectoryName -like '*win64*' } |
           Select-Object -First 1

if (-not $nssmExe) {
    $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter 'nssm.exe' | Select-Object -First 1
}

if (-not $nssmExe) {
    throw 'Could not find nssm.exe in archive'
}

Copy-Item -Path $nssmExe.FullName -Destination $targetPath -Force
Write-Host "NSSM copied to: $targetPath"

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue

Write-Host 'Done!'
