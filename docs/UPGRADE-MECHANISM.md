# Upgrade Mechanism

This document describes how the IT Dashboard Agent handles upgrades.

## Overview

The agent supports two upgrade methods:

1. **Manual Upgrade** - Triggered via dashboard command
2. **Auto-Upgrade** - Automatic upgrade when new version detected

## How Upgrades Work

### Upgrade Flow

```
1. Dashboard heartbeat returns:
   - latest_agent_version
   - agent_download_url
   - upgrade_available (boolean)

2. Agent compares versions
   │
   ├─> If upgrade_available && (manual command OR auto-upgrade enabled):
   │     │
   │     ├─> 1. Create backup of current installation
   │     ├─> 2. Download new version ZIP
   │     ├─> 3. Extract to temp directory
   │     ├─> 4. Run npm install && npm run build
   │     ├─> 5. Verify build succeeded
   │     ├─> 6. Swap files (replace dist/, package.json, etc.)
   │     ├─> 7. Exit with code 0
   │     │
   │     └─> Service manager restarts agent with new version
   │
   └─> On failure: Rollback from backup
```

### Backup & Rollback

Before upgrading, the agent creates a backup of:
- `dist/` directory
- `package.json`
- `package-lock.json`

If the upgrade fails at any step, the agent automatically restores from backup.

## Manual Upgrade

### From Dashboard

1. Navigate to **Admin > Agents**
2. Find the agent with an outdated version (shown in red/yellow badge)
3. Click **"Upgrade to vX.X.X"** button

The dashboard sends an `upgrade` command to the agent, which triggers the upgrade process.

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

## Auto-Upgrade

Auto-upgrade is opt-in and disabled by default for safety.

### Configuration

Set these environment variables in `.env`:

```bash
# Enable auto-upgrade (default: false)
ENABLE_AUTO_UPGRADE=true

# Allow auto-upgrade for minor versions (default: true)
# When true: auto-upgrades 1.0.0 -> 1.1.0 or 1.0.0 -> 1.0.1
# When false: only auto-upgrades patches 1.0.0 -> 1.0.1
AUTO_UPGRADE_ON_MINOR=true
```

### Auto-Upgrade Rules

| Upgrade Type | Example | Auto-Upgrade Behavior |
|--------------|---------|----------------------|
| Patch | 1.0.0 → 1.0.1 | Always allowed |
| Minor | 1.0.0 → 1.1.0 | Allowed if `AUTO_UPGRADE_ON_MINOR=true` |
| Major | 1.0.0 → 2.0.0 | **Never** auto-upgraded |

Major version upgrades are never automatic because they may contain breaking changes requiring manual intervention.

## Troubleshooting

### Upgrade Failed - Agent Not Starting

1. Check the service logs:
   ```bash
   # Windows
   Get-Content C:\ProgramData\it-dashboard-agent\logs\service.log -Tail 50

   # Linux
   journalctl -u it-dashboard-agent -f

   # macOS
   tail -f /opt/it-dashboard-agent/logs/agent.log
   ```

2. Try manual rollback by running the installer and selecting **[F] Fresh install**

### Upgrade Stuck / Agent Offline

1. Stop the service manually:
   ```bash
   # Windows
   nssm stop ITDashboardAgent

   # Linux
   sudo systemctl stop it-dashboard-agent

   # macOS
   sudo launchctl unload /Library/LaunchDaemons/com.itdashboard.agent.plist
   ```

2. Run the installer to reinstall

### Download Failed

Check network connectivity. The agent downloads from:
- `https://github.com/velocityeu/it-dashboard-agent/archive/refs/heads/master.zip`

Ensure this URL is accessible from the agent machine.

### Build Failed

Common causes:
- Node.js not installed or outdated (requires v18+)
- Insufficient disk space
- Network issues during `npm install`

Try running manually:
```bash
cd /opt/it-dashboard-agent  # or C:\ProgramData\it-dashboard-agent
npm install
npm run build
```

## Files Involved

### Agent Files

| File | Purpose |
|------|---------|
| `src/upgrade/upgrader.ts` | Upgrade logic, backup/rollback |
| `src/utils/version.ts` | Version comparison utilities |
| `src/config.ts` | Auto-upgrade configuration |
| `src/index.ts` | Upgrade command handler |

### Dashboard Files

| File | Purpose |
|------|---------|
| `src/lib/constants.ts` | LATEST_AGENT_VERSION constant |
| `src/app/api/agent/heartbeat/route.ts` | Returns version info |
| `src/app/api/admin/agents/[id]/commands/route.ts` | Accepts upgrade command |
| `src/app/admin/agents/page.tsx` | Upgrade button UI |
