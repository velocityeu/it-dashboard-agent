# Upgrade Mechanism

**Version:** 3.2.0

This document describes how the IT Dashboard Agent handles upgrades.

## Overview

The agent supports three upgrade methods:

1. **Manual Upgrade** - Triggered via dashboard command
2. **Auto-Upgrade** - Automatic upgrade when new version detected
3. **Dashboard-Enforced Upgrade** - Dashboard auto-queues upgrades for outdated agents

## How Upgrades Work

### Platform-Specific Behavior

Upgrades work differently depending on the platform:

| Platform | Method | Reason |
|----------|--------|--------|
| **Windows** | External PowerShell script | Avoids file lock issues (running process can't update itself) |
| **Linux/macOS** | In-process upgrade | Unix systems handle file replacement better |

---

## Windows Upgrade Process (v3.2.0+)

On Windows, upgrades are handled by an external PowerShell script (`scripts/upgrade-service.ps1`) that runs independently of the agent process.

### Why External Script?

When the agent tries to upgrade itself on Windows:
1. The running Node.js process has file handles open on `dist/`, `node_modules/`
2. These files cannot be replaced while the process is running
3. Even stopping the NSSM service doesn't release handles fast enough

**Solution:** Spawn an external PowerShell script, then exit immediately. The script handles everything.

### Windows Upgrade Flow

```
Dashboard                    Agent                       PowerShell Script
    |                          |                               |
    |-- upgrade command ------>|                               |
    |                          |                               |
    |                          |-- Spawn upgrade-service.ps1 ->|
    |                          |                               |
    |                          |<- Exit immediately            |
    |                          |                               |
    |                          |                    1. Stop NSSM service
    |                          |                    2. Wait for handles release
    |                          |                    3. Backup current install
    |                          |                    4. Download new version
    |                          |                    5. Extract archive
    |                          |                    6. npm install && build
    |                          |                    7. Verify build
    |                          |                    8. Swap files
    |                          |                    9. Start NSSM service
    |                          |                               |
    |                          |<-------- New agent starts ----|
```

### Upgrade Status File

The PowerShell script writes progress to `upgrade-status.json`:

```json
{
  "status": "installing",
  "message": "Installing new version",
  "timestamp": "2026-01-28T10:30:00.000Z",
  "previous_version": "3.1.0",
  "new_version": "3.2.0",
  "error": ""
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| `starting` | Upgrade process beginning |
| `stopping` | Stopping agent service |
| `backup` | Creating backup |
| `downloading` | Downloading new version |
| `extracting` | Extracting archive |
| `building` | Running npm install/build |
| `verifying` | Verifying build output |
| `installing` | Swapping files |
| `completed` | Upgrade successful |
| `failed` | Upgrade failed (check error field) |
| `rolled_back` | Failed and rolled back to previous version |

### Upgrade Log

Detailed logs are written to `logs/upgrade.log`:

```
[2026-01-28 10:30:00] [INFO] ========================================
[2026-01-28 10:30:00] [INFO] IT Dashboard Agent Upgrade Script
[2026-01-28 10:30:00] [INFO] ========================================
[2026-01-28 10:30:00] [INFO] Install Path: C:\ProgramData\it-dashboard-agent
[2026-01-28 10:30:00] [INFO] Download URL: https://github.com/...
[2026-01-28 10:30:00] [INFO] Current version: 3.1.0
[2026-01-28 10:30:01] [INFO] Stopping ITDashboardAgent service...
[2026-01-28 10:30:03] [INFO] Service stopped successfully
...
```

### Development Mode

When running in development mode (no NSSM service):
- The script detects the service doesn't exist
- Skips service stop/start operations
- Still performs backup, download, extract, and swap
- Logs warning: "Service not found - running in development mode"

---

## Linux/macOS Upgrade Process

On Unix systems, upgrades use the in-process method:

```
1. Dashboard heartbeat returns:
   - latest_agent_version
   - agent_download_url
   - upgrade_available (boolean)

2. Agent compares versions
   |
   +-> If upgrade needed:
   |     |
   |     +-> 1. Create backup of current installation
   |     +-> 2. Download new version ZIP
   |     +-> 3. Extract to temp directory
   |     +-> 4. Run npm install && npm run build
   |     +-> 5. Verify build succeeded
   |     +-> 6. Swap files (replace dist/, package.json, etc.)
   |     +-> 7. Exit with code 0
   |     |
   |     +-> Service manager restarts agent with new version
   |
   +-> On failure: Rollback from backup
```

---

## Dashboard-Enforced Auto-Upgrade

The dashboard can enforce that all agents run the latest version. When enabled:

1. Every heartbeat checks if agent version matches `LATEST_AGENT_VERSION`
2. If outdated, dashboard automatically queues an upgrade command
3. Agent receives upgrade command via Supabase Realtime
4. Upgrade proceeds immediately

### Dashboard Configuration

In the dashboard's `src/lib/constants.ts`:

```typescript
// Auto-update enforcement
// When true, ANY agent not running the exact LATEST_AGENT_VERSION will be auto-upgraded
export const ENFORCE_AGENT_UPDATES = true
export const LATEST_AGENT_VERSION = '3.2.0'
```

### Command Payload

Auto-queued upgrade commands include a flag:

```json
{
  "command_type": "upgrade",
  "payload": {
    "download_url": "https://github.com/.../master.zip",
    "target_version": "3.2.0",
    "auto_queued": true
  }
}
```

---

## Backup & Rollback

Before upgrading, a backup is created containing:
- `dist/` directory
- `package.json`
- `package-lock.json`
- `.env` file (Windows only)

**Backup Location:**
- Windows: `C:\ProgramData\it-dashboard-agent-backup-YYYYMMDD-HHmmss`
- Linux/macOS: `/opt/it-dashboard-agent.backup-YYYYMMDD-HHmmss`

If the upgrade fails at any step, the agent automatically restores from backup.

---

## Manual Upgrade

### From Dashboard

1. Navigate to **Admin > Agents**
2. Find the agent with an outdated version (shown in red/yellow badge)
3. Click **"Upgrade to vX.X.X"** button

The dashboard sends an `upgrade` command to the agent.

### From Installer

Run the installer script again:

**Windows:**
```powershell
irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.ps1 | iex
```

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.sh | sudo bash
```

Select **[U] Upgrade** when prompted.

---

## Auto-Upgrade (Agent-Side)

Auto-upgrade is opt-in on the agent side and disabled by default.

### Configuration

Set in `.env`:

```bash
# Enable auto-upgrade (default: false)
ENABLE_AUTO_UPGRADE=true

# Allow auto-upgrade for minor versions (default: true)
AUTO_UPGRADE_ON_MINOR=true
```

### Auto-Upgrade Rules

| Upgrade Type | Example | Auto-Upgrade Behavior |
|--------------|---------|----------------------|
| Patch | 1.0.0 -> 1.0.1 | Always allowed |
| Minor | 1.0.0 -> 1.1.0 | Allowed if `AUTO_UPGRADE_ON_MINOR=true` |
| Major | 1.0.0 -> 2.0.0 | **Never** auto-upgraded |

Major version upgrades are never automatic because they may contain breaking changes.

---

## Troubleshooting

### Windows: Check Upgrade Status

```powershell
# View upgrade status
Get-Content C:\ProgramData\it-dashboard-agent\upgrade-status.json

# View upgrade log
Get-Content C:\ProgramData\it-dashboard-agent\logs\upgrade.log -Tail 50
```

### Windows: Upgrade Stuck

1. Check if the upgrade script is still running:
   ```powershell
   Get-Process powershell | Where-Object {$_.CommandLine -like "*upgrade-service*"}
   ```

2. Check upgrade status file for errors

3. Manually stop any stuck processes:
   ```powershell
   nssm stop ITDashboardAgent
   Stop-Process -Name node -Force
   ```

4. Run installer to reinstall

### Agent Not Starting After Upgrade

1. Check the service logs:
   ```powershell
   # Windows
   Get-Content C:\ProgramData\it-dashboard-agent\logs\agent-*.log -Tail 50

   # Linux
   journalctl -u it-dashboard-agent -f

   # macOS
   tail -f /opt/it-dashboard-agent/logs/agent.log
   ```

2. Try manual rollback:
   ```powershell
   # Windows - restore from backup
   Copy-Item -Path C:\ProgramData\it-dashboard-agent-backup-*\* -Destination C:\ProgramData\it-dashboard-agent -Recurse -Force
   nssm restart ITDashboardAgent
   ```

### Download Failed

Check network connectivity. The agent downloads from:
- `https://github.com/velocityeu/it-dashboard-agent/archive/refs/heads/master.zip`

Retry logic: 3 attempts with 5-second delays between retries.

### Build Failed

Common causes:
- Node.js not installed or outdated (requires v18+)
- Insufficient disk space
- Network issues during `npm install`

Try running manually:
```powershell
cd C:\ProgramData\it-dashboard-agent
npm install
npm run build
```

---

## Files Involved

### Agent Files

| File | Purpose |
|------|---------|
| `src/upgrade/upgrader.ts` | Upgrade coordination, backup/rollback |
| `scripts/upgrade-service.ps1` | Windows external upgrade orchestrator |
| `src/utils/version.ts` | Version comparison utilities |
| `src/config.ts` | Auto-upgrade configuration |
| `src/index.ts` | Upgrade command handler |
| `upgrade-status.json` | Runtime upgrade progress (Windows) |
| `logs/upgrade.log` | Detailed upgrade log (Windows) |

### Dashboard Files

| File | Purpose |
|------|---------|
| `src/lib/constants.ts` | `LATEST_AGENT_VERSION`, `ENFORCE_AGENT_UPDATES` |
| `src/app/api/agent/heartbeat/route.ts` | Returns version info, auto-queues upgrades |
| `src/app/api/admin/agents/[id]/commands/route.ts` | Accepts upgrade command |
| `src/app/admin/agents/page.tsx` | Upgrade button UI |
