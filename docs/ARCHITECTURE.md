# IT Dashboard Agent Architecture

This document describes the complete architecture of the IT Dashboard Agent and its communication with the cloud dashboard.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IT DASHBOARD AGENT                                │
│                          (runs on local network)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Scanner    │  │   Status     │  │   Realtime   │  │   Agent UI   │   │
│  │   Module     │  │   Checker    │  │   Client     │  │   Server     │   │
│  │              │  │              │  │              │  │              │   │
│  │ - ARP scan   │  │ - Ping       │  │ - Segment    │  │ - Express    │   │
│  │ - Ping sweep │  │ - TCP        │  │   changes    │  │ - Socket.IO  │   │
│  │ - OUI lookup │  │ - HTTP       │  │ - Commands   │  │ - REST API   │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │                  │           │
│         └────────────┬────┴─────────────────┼──────────────────┘           │
│                      │                      │                               │
│                      ▼                      ▼                               │
│              ┌──────────────────────────────────────┐                      │
│              │           Main Loop (index.ts)        │                      │
│              │                                       │                      │
│              │  - Heartbeat every 60s (5m if RT)    │                      │
│              │  - Status checks every 30s            │                      │
│              │  - Segment scans per interval         │                      │
│              │  - Command handler                    │                      │
│              └──────────────────┬───────────────────┘                      │
│                                 │                                           │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
         ┌──────────────────┐       ┌──────────────────┐
         │   REST API       │       │  Supabase        │
         │   (HTTPS)        │       │  Realtime (WSS)  │
         │                  │       │                  │
         │  Agent → Cloud   │       │  Cloud → Agent   │
         └────────┬─────────┘       └────────┬─────────┘
                  │                          │
                  └──────────┬───────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           IT DASHBOARD                                       │
│                     (Vercel + Supabase Cloud)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │    Next.js App   │  │   Supabase DB    │  │   Supabase       │          │
│  │                  │  │                  │  │   Realtime       │          │
│  │  - Admin UI      │  │  - agents        │  │                  │          │
│  │  - Agent APIs    │  │  - devices       │  │  - WebSocket     │          │
│  │  - Device views  │  │  - segments      │  │  - Pub/Sub       │          │
│  │                  │  │  - commands      │  │  - Postgres CDC  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Bidirectional Communication

### Agent → Dashboard (REST API)

| Endpoint | Method | Purpose | Interval |
|----------|--------|---------|----------|
| `/api/agent/heartbeat` | POST | Register agent, get segments, get Supabase creds | 60s (5m if realtime connected) |
| `/api/agent/devices/discovered` | POST | Upload discovered devices from scan | Per scan |
| `/api/agent/devices/status` | POST | Upload device status reports | 30s |
| `/api/agent/devices` | GET | Get list of devices to monitor | Per status check |
| `/api/agent/segments/register` | POST | Auto-register local network segment | On startup (if no segments) |
| `/api/agent/commands/{id}/ack` | POST | Acknowledge command execution | After command |

### Dashboard → Agent (Supabase Realtime)

The agent subscribes to two Supabase Realtime channels:

1. **Segment Changes Channel** (`agent:{agentId}:segments`)
   - Listens to: `INSERT`, `UPDATE`, `DELETE` on `network_segments` table
   - Filter: `agent_id=eq.{agentId}`
   - Triggers: Immediate segment list update, auto-scan on new segments

2. **Commands Channel** (`agent:{agentId}:commands`)
   - Listens to: `INSERT` on `agent_commands` table
   - Filter: `agent_id=eq.{agentId}`
   - Triggers: Immediate command execution

### Command Types

| Command | Source | Action |
|---------|--------|--------|
| `scan_now` | Dashboard "Scan Now" button | Scan all assigned segments immediately |
| `scan_segment` | Dashboard (future) | Scan specific segment by ID |
| `upgrade` | Dashboard "Upgrade" button | Download and install new version |
| `restart` | Dashboard (future) | Restart agent process |
| `update_config` | Dashboard (future) | Update runtime configuration |

## Key Source Files

### Agent (it-dashboard-agent)

| File | Purpose |
|------|---------|
| `src/index.ts` | Main orchestration, command handling, heartbeat loop |
| `src/config.ts` | Configuration loading from .env |
| `src/api/client.ts` | REST API client for dashboard calls |
| `src/api/realtime-client.ts` | Supabase WebSocket subscription management |
| `src/scanner/discover.ts` | Device discovery orchestration |
| `src/scanner/arp.ts` | ARP-based discovery (local networks) |
| `src/scanner/ping.ts` | ICMP ping checks and ping sweep |
| `src/scanner/tcp.ts` | TCP port connectivity checks |
| `src/scanner/http.ts` | HTTP/HTTPS endpoint checks |
| `src/ui/server.ts` | Local Agent UI (Express + Socket.IO) |
| `src/utils/network-detect.ts` | Auto-detect local network CIDR |
| `src/upgrade/upgrader.ts` | In-place upgrade with backup/rollback |

### Dashboard (it-dashboard)

| File | Purpose |
|------|---------|
| `src/app/admin/agents/page.tsx` | Agent management UI with Scan Now button |
| `src/app/api/admin/agents/[id]/commands/route.ts` | API to send commands to agents |
| `src/app/api/agent/heartbeat/route.ts` | Heartbeat endpoint, returns Supabase creds |
| `src/app/api/agent/devices/discovered/route.ts` | Receive discovered devices |
| `src/app/api/agent/devices/status/route.ts` | Receive status reports |
| `src/lib/constants.ts` | `LATEST_AGENT_VERSION` for upgrade detection |

## Database Schema (Supabase)

### agents
```sql
- id: uuid (PK)
- name: text
- description: text
- api_key_hash: text
- api_key_prefix: text
- is_enabled: boolean
- version: text
- last_seen_at: timestamptz
- last_ip_address: text
- created_at: timestamptz
```

### network_segments
```sql
- id: uuid (PK)
- agent_id: uuid (FK → agents)
- name: text
- cidr: text
- scan_interval_seconds: int (default: 300)
- is_auto_registered: boolean
- interface_name: text
- last_scan_at: timestamptz
- last_scan_device_count: int
- created_at: timestamptz
```

### agent_commands
```sql
- id: uuid (PK)
- agent_id: uuid (FK → agents)
- command_type: text ('scan_now', 'scan_segment', 'upgrade', 'restart', 'update_config')
- payload: jsonb
- status: text ('pending', 'completed', 'failed')
- created_at: timestamptz
- executed_at: timestamptz
- error: text
```

### devices
```sql
- id: uuid (PK)
- segment_id: uuid (FK → network_segments)
- ip_address: text
- mac_address: text
- hostname: text
- manufacturer: text
- device_type: text
- is_monitored: boolean
- check_type: text ('ping', 'tcp', 'http')
- port: int
- url: text
- status: text ('online', 'offline', 'degraded', 'unknown')
- last_check_at: timestamptz
- response_time_ms: int
```

## Configuration

### Environment Variables (.env)

```env
# Required
DASHBOARD_URL=https://it-dashboard-gray.vercel.app
AGENT_API_KEY=agt_xxxxx

# Optional
AGENT_NAME=My Agent
HEARTBEAT_INTERVAL=60      # seconds
STATUS_CHECK_INTERVAL=30   # seconds
LOG_LEVEL=info            # debug, info, warn, error
ENABLE_REALTIME=true      # Enable Supabase Realtime
ENABLE_AUTO_SCAN=true     # Auto-detect local network
ENABLE_AUTO_UPGRADE=false # Auto-upgrade (opt-in)
AUTO_UPGRADE_ON_MINOR=true
```

## Realtime Connection Flow

```
1. Agent starts
2. Sends heartbeat to /api/agent/heartbeat
3. Dashboard returns:
   - agent_id
   - segments[]
   - supabase_url
   - supabase_anon_key
4. Agent creates Supabase client
5. Subscribes to channels:
   - agent:{agentId}:segments (postgres_changes on network_segments)
   - agent:{agentId}:commands (postgres_changes on agent_commands)
6. Callbacks registered:
   - onSegmentChanges → handleSegmentChange()
   - onCommands → handleCommand()
7. Agent is now live for instant updates
```

## Fallback Mode

If Supabase Realtime is unavailable or disabled (`ENABLE_REALTIME=false`):
- Agent relies on heartbeat polling (60s interval)
- Commands received on next heartbeat
- Segment changes received on next heartbeat
- Higher latency but still functional

## Agent UI

Local web interface at `http://localhost:3001`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Main UI page |
| `/api/status` | GET | Agent connection status |
| `/api/segments` | GET | List of segments |
| `/api/devices` | GET | Discovered devices |
| `/api/logs` | GET | Recent log entries |
| `/api/scan/:segmentId` | POST | Trigger manual scan |

Socket.IO events for real-time UI updates:
- `state` - Full state snapshot on connect
- `connectionStatus` - Dashboard connection status
- `realtimeStatus` - Supabase realtime status
- `heartbeat` - Heartbeat timestamp
- `segments` - Segment list update
- `devices` - Device list update
- `deviceStatuses` - Status updates
- `scanProgress` - Scan progress
- `log` - New log entry
- `versionInfo` - Version and upgrade status
