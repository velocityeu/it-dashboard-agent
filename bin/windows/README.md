# Windows Binaries

This directory contains bundled binaries for Windows installations.

## nssm.exe

NSSM (Non-Sucking Service Manager) v2.24 - Used to install and manage the IT Dashboard Agent as a Windows service.

- Website: https://nssm.cc/
- License: Public Domain
- Architecture: 64-bit

The installer will use this bundled binary instead of downloading it, improving reliability and supporting offline installations.

## Updating NSSM

To update the NSSM binary:

```powershell
powershell -ExecutionPolicy Bypass -File download-nssm.ps1
```

Or manually download from https://nssm.cc/release/nssm-2.24.zip and extract the win64/nssm.exe to this directory.
