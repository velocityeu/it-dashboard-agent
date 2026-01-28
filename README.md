# IT Dashboard Agent

[![Version](https://img.shields.io/badge/version-3.2.2-blue.svg)](https://github.com/velocityeu/it-dashboard-agent)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Local network monitoring agent for the IT Dashboard. Discovers devices on your network and reports their status to the cloud dashboard in real-time.

## What's New in v3.2.2

- **Realtime Reliability Fixes**: Ping works on first attempt, status updates within 15 seconds
- **Robust Reconnection**: Socket.IO and Supabase realtime auto-reconnect with exponential backoff
- **Connection Health Monitoring**: UI shows socket connection status, detects stale connections
- **Heartbeat Improvements**: Capped at 60s max, retry logic with 2s/5s/10s delays on failure
- **Memory Leak Fix**: Device statuses cleaned up when segments are removed

### Previous Releases

**v3.2.0:**
- Windows Upgrade Orchestrator: PowerShell script handles upgrades externally
- Upgrade Status Tracking: `upgrade-status.json` for real-time progress
- Development Mode Support: Graceful handling when no service exists

**v3.1.0:**
- Improved log clarity and error handling messages

**v3.0.0:**
- Log Rotation: Automatic daily log rotation with 7-day retention and gzip compression
- Toast Notifications: Non-blocking notifications replace browser alerts in dashboard
- Ping All Online Agents: Dashboard ping button now pings all online agents in parallel
- Individual Ping Buttons: Each agent card has a dedicated Ping button
- Improved Installer: Pre-packaged NSSM binary, prerequisite checks (Windows version, disk space, port availability)
- Offline Installation: Create air-gapped bundles for installations without internet
- Upgrade Retry Logic: 3 retries with 5-second delays for failed downloads
- Pre-built Releases: GitHub releases include node_modules for faster installation

## Quick Install

**Windows** (PowerShell as Administrator):
```powershell
irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/bootstrap.ps1 | iex
```

Or download and run directly:
```powershell
iwr -Uri "https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.ps1" -OutFile "$env:TEMP\install.ps1"; & "$env:TEMP\install.ps1"
```

**macOS / Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/install.sh | sudo bash
```

The installer will:
1. Check for Node.js 18+ (installs if missing)
2. Download source code to `/opt/it-dashboard-agent` (Unix) or `C:\ProgramData\it-dashboard-agent` (Windows)
3. Prompt for Dashboard URL, API Key, and Agent Name
4. Build and install as a system service
5. Start the agent automatically

**No Git required** - the installer downloads a ZIP archive directly from GitHub.

### Pre-built Releases (Faster)

Download pre-built releases from [GitHub Releases](https://github.com/velocityeu/it-dashboard-agent/releases) for faster installation - includes `node_modules` so no `npm install` required.

### Offline Installation

For air-gapped networks without internet:

1. **On a machine with internet**, create an offline bundle:
   ```powershell
   .\scripts\create-offline-bundle.ps1 -IncludeNodeJs
   ```

2. Copy the generated `it-dashboard-agent-X.X.X-offline.zip` to the target machine

3. **On the air-gapped machine**:
   ```powershell
   Expand-Archive it-dashboard-agent-*-offline.zip -DestinationPath .
   cd it-dashboard-agent-*-offline
   .\install-offline.ps1
   ```

**Uninstall:**
```powershell
# Windows
irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.ps1 | iex

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/master/scripts/uninstall.sh | sudo bash
```

## Features

- **Device Discovery**: Scans network segments using ARP to discover devices (IP, MAC, hostname, manufacturer)
- **Status Monitoring**: Checks device status via ICMP ping, TCP port, or HTTP endpoints
- **Status Hysteresis**: Prevents rapid status flapping - devices only go offline after 2 consecutive failed checks
- **Agent UI**: Built-in web interface at http://localhost:3001 showing discovered devices and status
- **Firewall-Friendly**: Uses HTTPS outbound connections only (no inbound ports required)
- **Multi-Segment**: Can monitor multiple network segments from a single agent
- **Real-time Updates**: Status changes are pushed to dashboard instantly via Supabase Realtime
- **Ping/Pong**: Bidirectional connectivity test with sonar sound feedback
- **Log Rotation** (v3.0.0): Daily rotating logs with 7-day retention and compression
- **Auto-Upgrade**: Safe upgrade mechanism with backup/rollback and retry logic

## Architecture

```
+-----------------------------------------------------------------+
|                    IT Dashboard Agent                            |
+-------+---------+---------+---------+---------------------------+
|       |         |         |         |                           |
| Scanner| Status | Realtime| Agent UI| Main Loop                 |
| (ARP)  | Checker| Client  | (3001)  | - Heartbeat               |
|        |        | (WSS)   |         | - Status checks           |
|        |        |         |         | - Ping/pong               |
+-------+---------+---------+---------+---------------------------+
         |                 |
         v                 v
    +----------+    +---------------+
    | REST API |    | Supabase      |
    | (HTTPS)  |    | Realtime(WSS) |
    +----------+    +---------------+
         |                 |
         v                 v
    +----------------------------------+
    |   IT Dashboard (Vercel + Supabase)|
    +----------------------------------+
```

For detailed architecture, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status Hysteresis

To prevent status flapping from brief network hiccups, the agent implements a **consecutive failure threshold**:

| Scenario | Result |
|----------|--------|
| Device responds | Immediately marked **online**, failure count reset |
| Device fails 1st check (was online) | Stays **online** (grace period) |
| Device fails 2nd consecutive check | Marked **offline** |
| Device responds after failures | Immediately **online**, count reset |

This ensures a single dropped packet doesn't cause the dashboard to show misleading status changes.

## Ping/Pong Feature

Test connectivity with instant audio feedback.

**v3.0.0 improvements:**
- "Ping All" now only pings online agents (skips offline)
- Pings all online agents in parallel
- Individual Ping button on each agent card in admin UI
- Non-blocking toast notifications instead of alerts

```
Dashboard                    Supabase                      Agent
    |--- Click "Ping" -------->|                            |
    |                          |--- Realtime --------------->|
    |                          |                             |
    |                          |                     [Sonar sound]
    |                          |<-- POST /agent/ping --------|
    |<-- Realtime -------------|                             |
    |                          |                             |
[Sonar sound]                  |                             |
```

Both sides play a sonar sound and the round-trip latency is displayed.

## Requirements

- Node.js 18+ (auto-installed by one-line installer)
- Windows 10/11, Windows Server 2016+, macOS, or Linux
- Network access to target segments
- Dashboard API key

**Note:** Git is NOT required. The one-line installer downloads source as a ZIP file.

## Installation

1. Clone or copy the agent to your local server:
   ```bash
   git clone https://github.com/velocityeu/it-dashboard-agent.git
   cd it-dashboard-agent
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create configuration file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your settings:
   ```env
   DASHBOARD_URL=https://it-dashboard-gray.vercel.app
   AGENT_API_KEY=agt_your_api_key_here
   AGENT_NAME=Office Agent
   ```

5. Build the agent:
   ```bash
   npm run build
   ```

6. Start the agent:
   ```bash
   npm start
   ```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DASHBOARD_URL` | URL of the IT Dashboard | Required |
| `AGENT_API_KEY` | API key from dashboard | Required |
| `AGENT_NAME` | Display name for this agent | IT Dashboard Agent |
| `HEARTBEAT_INTERVAL` | Heartbeat frequency (ms) | 60000 |
| `STATUS_CHECK_INTERVAL` | Status check frequency (ms) | 30000 |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | info |
| `LOG_DIR` | Directory for log files | `./logs` |
| `ENABLE_AUTO_UPGRADE` | Enable automatic upgrades | false |
| `AUTO_UPGRADE_ON_MINOR` | Auto-upgrade minor versions (not just patches) | true |

## Logging

The agent uses Winston for logging with automatic daily rotation.

**Log location:** `./logs/agent-YYYY-MM-DD.log`

**Features:**
- Daily log rotation at midnight
- Maximum file size: 10MB (rotates if exceeded)
- Retention: 7 days
- Old logs compressed with gzip
- Console output with colors, file output without

**Log levels:** `debug`, `info`, `warn`, `error`

Set via `LOG_LEVEL` environment variable (default: `info`).

## Version Management

The agent supports automatic version checking and upgrades.

### Checking for Updates

Every heartbeat, the dashboard returns the latest agent version. The agent UI shows:
- Current version (stat card)
- "Update Available" badge when a newer version exists

### Upgrading

**From Dashboard:**
1. Go to Admin > Agents
2. Find the agent with an outdated version (yellow/red badge)
3. Click "Upgrade to vX.X.X"

**From Installer:**
Run the installer again and select `[U] Upgrade`.

**Automatic Upgrades:**
Set `ENABLE_AUTO_UPGRADE=true` in `.env` to enable auto-upgrades.

| Upgrade Type | Auto-Upgrade Behavior |
|--------------|----------------------|
| Patch (1.0.0 -> 1.0.1) | Always allowed |
| Minor (1.0.0 -> 1.1.0) | Allowed if `AUTO_UPGRADE_ON_MINOR=true` |
| Major (1.0.0 -> 2.0.0) | Never automatic (may have breaking changes) |

See [docs/UPGRADE-MECHANISM.md](docs/UPGRADE-MECHANISM.md) for details.

## Agent UI

The agent includes a built-in web interface for local monitoring and debugging.

**Access:** http://localhost:3001

### Features

- **Connection Status**: Shows if agent is connected to dashboard
- **Version Info**: Current version and update availability
- **Network Segments**: Lists assigned segments with scan progress
- **Discovered Devices**: Table showing all discovered devices with:
  - Status (online/offline/degraded) with color indicators
  - IP Address
  - Hostname
  - Manufacturer
  - Response time
  - Last check time
- **Activity Log**: Real-time log of agent operations

### Screenshot

```
+--------------------------------------------------------------+
|  IT Dashboard Agent - Home Office Agent                       |
|  * Connected to dashboard                  Version: 3.0.0     |
+--------------------------------------------------------------+
|  Segments                                                     |
|  +--------------------------------------------------------+ |
|  | HomeOffice (10.117.1.0/24)          [Scan Now]          | |
|  | Progress: #################### 100%                     | |
|  +--------------------------------------------------------+ |
+--------------------------------------------------------------+
|  Discovered Devices (9)                                       |
|  +----------+---------------+--------------+------------+    |
|  | Status   | IP Address    | Hostname     | Response   |    |
|  +----------+---------------+--------------+------------+    |
|  | * Online | 10.117.1.1    | router       | 2ms        |    |
|  | * Online | 10.117.1.100  | desktop-pc   | 5ms        |    |
|  | o Offline| 10.117.1.127  | printer      | -          |    |
|  +----------+---------------+--------------+------------+    |
+--------------------------------------------------------------+
```

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Run tests
npm test
```

## How It Works

1. **Startup**: Agent loads config and connects to dashboard
2. **Heartbeat**: Sends periodic heartbeat, receives assigned network segments
3. **Discovery**: For each segment:
   - Populates ARP cache by pinging subnet broadcast
   - Reads ARP table to discover devices (IP + MAC)
   - Resolves hostnames and manufacturer from MAC OUI
4. **Upload**: Discovered devices are uploaded to dashboard
5. **Monitor**: Agent retrieves list of monitored devices
6. **Status Checks**: Runs checks based on device configuration:
   - `ping` - ICMP echo (default)
   - `tcp` - TCP port connect
   - `http` - HTTP/HTTPS request
7. **Hysteresis**: Applies consecutive failure threshold before marking offline
8. **Report**: Stabilized status results uploaded to dashboard
9. **Realtime**: Dashboard receives update via Supabase Realtime
10. **Commands**: Agent receives commands (scan, ping, upgrade) via Realtime

## Running as a Service

### Windows

Use [NSSM](https://nssm.cc/) to run as a Windows service:
```cmd
nssm install ITDashboardAgent "C:\path\to\node.exe" "C:\path\to\it-dashboard-agent\dist\index.js"
nssm set ITDashboardAgent AppDirectory "C:\path\to\it-dashboard-agent"
nssm start ITDashboardAgent
```

### Linux (systemd)

Create `/etc/systemd/system/it-dashboard-agent.service`:
```ini
[Unit]
Description=IT Dashboard Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/it-dashboard-agent
ExecStart=/usr/bin/node /opt/it-dashboard-agent/dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable it-dashboard-agent
sudo systemctl start it-dashboard-agent
```

### macOS (launchd)

Create `~/Library/LaunchAgents/com.itdashboard.agent.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.itdashboard.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/it-dashboard-agent/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/opt/it-dashboard-agent</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## Project Structure

```
src/
+-- index.ts              # Main entry point and orchestration
+-- config.ts             # Configuration loader
+-- api/
|   +-- client.ts         # Dashboard API client
|   +-- realtime-client.ts# Supabase realtime connection
+-- scanner/
|   +-- arp.ts            # ARP scanning and device discovery
|   +-- ping.ts           # ICMP ping checks
|   +-- tcp.ts            # TCP port checks
|   +-- http.ts           # HTTP/HTTPS checks
+-- upgrade/
|   +-- upgrader.ts       # Auto-upgrade with backup/rollback
+-- ui/
|   +-- server.ts         # Agent UI server (Express + Socket.IO)
|   +-- public/
|       +-- index.html    # Agent UI frontend
+-- utils/
    +-- logger.ts         # Winston logger setup
    +-- version.ts        # Centralized version management

docs/
+-- ARCHITECTURE.md           # Full system architecture
+-- E2E-TEST-RESULTS.md       # End-to-end test results
+-- REALTIME-COMMUNICATION.md # Bidirectional realtime guide
+-- VERSION-CONTROL.md        # Version policy and release process
+-- UPGRADE-MECHANISM.md      # How upgrades work

tests/
+-- version.test.ts       # Version utility tests
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system architecture and component design |
| [REALTIME-COMMUNICATION.md](docs/REALTIME-COMMUNICATION.md) | WebSocket and Supabase Realtime details |
| [UPGRADE-MECHANISM.md](docs/UPGRADE-MECHANISM.md) | How automatic upgrades work |
| [VERSION-CONTROL.md](docs/VERSION-CONTROL.md) | Version policy and release process |
| [E2E-TEST-RESULTS.md](docs/E2E-TEST-RESULTS.md) | End-to-end test results |

## Troubleshooting

### No devices discovered
- Ensure ARP cache has entries: `arp -a` (Windows) or `arp -an` (Linux/macOS)
- Try pinging devices first to populate ARP cache
- Check CIDR range is correct in dashboard
- Verify agent has network access to the segment

### Connection refused
- Verify `DASHBOARD_URL` is correct
- Check firewall allows outbound HTTPS (port 443)
- Verify API key is valid in dashboard admin

### Permission denied (Linux/macOS)
- ARP scanning may require root/sudo
- Run agent with elevated privileges if needed

### Status flapping
- The agent has built-in hysteresis (2 consecutive failures)
- If still flapping, check network stability
- Increase `STATUS_CHECK_INTERVAL` for slower checks

### Agent UI not accessible
- Check port 3001 is not in use: `netstat -an | grep 3001`
- Verify firewall allows local connections to 3001
- Check agent logs for startup errors

### Realtime not working
- Check logs for "Supabase Realtime connected"
- Verify firewall allows WebSocket (wss://)
- See [docs/REALTIME-COMMUNICATION.md](docs/REALTIME-COMMUNICATION.md)

## Related Projects

- [IT Dashboard](../it-dashboard) - Cloud dashboard frontend

## License

MIT
