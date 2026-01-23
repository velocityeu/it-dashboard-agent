# IT Dashboard Agent

Local network monitoring agent for the IT Dashboard. Discovers devices on your network and reports their status to the cloud dashboard.

## Features

- **Device Discovery**: Scans network segments using ARP to discover devices
- **Status Monitoring**: Checks device status via ICMP ping, TCP port, or HTTP endpoints
- **Firewall-Friendly**: Uses HTTPS outbound connections only
- **Multi-Segment**: Can monitor multiple network segments from a single agent

## Requirements

- Node.js 18+
- Windows, macOS, or Linux
- Network access to target segments
- Dashboard API key

## Installation

1. Clone or copy the agent to your local server:
   ```bash
   git clone <repo-url> it-dashboard-agent
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
   ```
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
| `HEARTBEAT_INTERVAL` | Heartbeat frequency (seconds) | 60 |
| `STATUS_CHECK_INTERVAL` | Status check frequency (seconds) | 30 |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | info |

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

1. **Heartbeat**: Agent sends periodic heartbeat to dashboard, receiving assigned network segments
2. **Discovery**: For each segment, agent scans ARP table to discover devices (IP + MAC)
3. **Upload**: Discovered devices are uploaded to dashboard
4. **Monitor**: Agent retrieves list of monitored devices from dashboard
5. **Status Checks**: Runs ping/TCP/HTTP checks on monitored devices
6. **Report**: Status results are uploaded to dashboard

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

## Troubleshooting

### No devices discovered
- Ensure ARP cache has entries: `arp -a` (Windows) or `arp -an` (Linux/macOS)
- Try pinging devices first to populate ARP cache
- Check CIDR range is correct in dashboard

### Connection refused
- Verify `DASHBOARD_URL` is correct
- Check firewall allows outbound HTTPS (port 443)
- Verify API key is valid

### Permission denied (Linux/macOS)
- ARP scanning may require root/sudo
- Run agent with elevated privileges if needed
