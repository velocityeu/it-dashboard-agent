# IT Dashboard Agent

Local network monitoring agent for the IT Dashboard. Discovers devices on your network and reports their status to the cloud dashboard in real-time.

## Quick Install

**Windows** (PowerShell as Administrator):
```powershell
irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/install.ps1 | iex
```

**macOS / Linux**:
```bash
curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/install.sh | sudo bash
```

The installer will:
1. Check for Node.js 18+ (installs if missing)
2. Clone the repository to `/opt/it-dashboard-agent` (Unix) or `C:\ProgramData\it-dashboard-agent` (Windows)
3. Prompt for Dashboard URL, API Key, and Agent Name
4. Build and install as a system service
5. Start the agent automatically

**Uninstall:**
```powershell
# Windows
irm https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/uninstall.ps1 | iex

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/velocityeu/it-dashboard-agent/main/scripts/uninstall.sh | sudo bash
```

## Features

- **Device Discovery**: Scans network segments using ARP to discover devices (IP, MAC, hostname, manufacturer)
- **Status Monitoring**: Checks device status via ICMP ping, TCP port, or HTTP endpoints
- **Status Hysteresis**: Prevents rapid status flapping - devices only go offline after 2 consecutive failed checks
- **Agent UI**: Built-in web interface at http://localhost:3001 showing discovered devices and status
- **Firewall-Friendly**: Uses HTTPS outbound connections only (no inbound ports required)
- **Multi-Segment**: Can monitor multiple network segments from a single agent
- **Real-time Updates**: Status changes are pushed to dashboard instantly via Supabase Realtime

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    IT Dashboard Agent                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Scanner   │  │   Status    │  │      Agent UI           │ │
│  │  (ARP/Ping) │  │   Checker   │  │  (Socket.IO + Express)  │ │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘ │
│         │                │                       │              │
│         │    ┌───────────┴───────────┐          │              │
│         └───▶│     Main Loop         │◀─────────┘              │
│              │  (Heartbeat, Scan,    │                         │
│              │   Status Check)       │                         │
│              └───────────┬───────────┘                         │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTPS
                           ▼
              ┌─────────────────────────┐
              │   IT Dashboard API      │
              │   (Vercel + Supabase)   │
              └─────────────────────────┘
```

## Status Hysteresis

To prevent status flapping from brief network hiccups, the agent implements a **consecutive failure threshold**:

| Scenario | Result |
|----------|--------|
| Device responds | Immediately marked **online**, failure count reset |
| Device fails 1st check (was online) | Stays **online** (grace period) |
| Device fails 2nd consecutive check | Marked **offline** |
| Device responds after failures | Immediately **online**, count reset |

This ensures a single dropped packet doesn't cause the dashboard to show misleading status changes.

## Requirements

- Node.js 18+
- Windows, macOS, or Linux
- Network access to target segments
- Dashboard API key

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

## Agent UI

The agent includes a built-in web interface for local monitoring and debugging.

**Access:** http://localhost:3001

### Features

- **Connection Status**: Shows if agent is connected to dashboard
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
┌──────────────────────────────────────────────────────────────┐
│  IT Dashboard Agent - Home Office Agent                      │
│  ● Connected to dashboard                    Last: 10:45:32  │
├──────────────────────────────────────────────────────────────┤
│  Segments                                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ HomeOffice (10.117.1.0/24)          [Scan Now]         │ │
│  │ Progress: ████████████████████ 100%                    │ │
│  └────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Discovered Devices (9)                                      │
│  ┌──────────┬───────────────┬──────────────┬────────────┐  │
│  │ Status   │ IP Address    │ Hostname     │ Response   │  │
│  ├──────────┼───────────────┼──────────────┼────────────┤  │
│  │ ● Online │ 10.117.1.1    │ router       │ 2ms        │  │
│  │ ● Online │ 10.117.1.100  │ desktop-pc   │ 5ms        │  │
│  │ ○ Offline│ 10.117.1.127  │ printer      │ -          │  │
│  └──────────┴───────────────┴──────────────┴────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
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
├── index.ts              # Main entry point and orchestration
├── config.ts             # Configuration loader
├── api/
│   └── client.ts         # Dashboard API client
├── scanner/
│   ├── arp.ts            # ARP scanning and device discovery
│   ├── ping.ts           # ICMP ping checks
│   ├── tcp.ts            # TCP port checks
│   └── http.ts           # HTTP/HTTPS checks
├── ui/
│   ├── server.ts         # Agent UI server (Express + Socket.IO)
│   └── public/
│       └── index.html    # Agent UI frontend
└── utils/
    └── logger.ts         # Winston logger setup
```

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

## Related Projects

- [IT Dashboard](../it-dashboard) - Cloud dashboard frontend

## License

MIT
