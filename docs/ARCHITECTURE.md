# IT Dashboard Agent Architecture

**Version:** 3.2.0

This document describes the complete architecture of the IT Dashboard Agent, including technology choices, component design, and communication patterns with the cloud dashboard.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [Bidirectional Communication](#bidirectional-communication)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Realtime Connection Flow](#realtime-connection-flow)

---

## System Overview

```
+-----------------------------------------------------------------------------+
|                           IT DASHBOARD AGENT                                |
|                          (runs on local network)                            |
+-----------------------------------------------------------------------------+
|                                                                             |
|  +-------------+  +-------------+  +-------------+  +------------------+   |
|  |   Scanner   |  |   Status    |  |   Realtime  |  |    Agent UI      |   |
|  |   Module    |  |   Checker   |  |   Client    |  |    Server        |   |
|  |             |  |             |  |             |  |                  |   |
|  | - ARP scan  |  | - Ping      |  | - Segment   |  | - Express        |   |
|  | - Ping sweep|  | - TCP       |  |   changes   |  | - Socket.IO      |   |
|  | - OUI lookup|  | - HTTP      |  | - Commands  |  | - REST API       |   |
|  | - Hostname  |  | - Hysteresis|  | - Ping/Pong |  | - Real-time UI   |   |
|  +------+------+  +------+------+  +------+------+  +--------+---------+   |
|         |                |                |                  |             |
|         +--------+-------+----------------+------------------+             |
|                  |                        |                                |
|                  v                        v                                |
|         +------------------------------------------+                       |
|         |           Main Loop (index.ts)           |                       |
|         |                                          |                       |
|         |  - Heartbeat every 60s (5m if RT)       |                       |
|         |  - Status checks every 30s              |                       |
|         |  - Segment scans per interval           |                       |
|         |  - Command handler                      |                       |
|         |  - Ping/pong response                   |                       |
|         +--------------------+---------------------+                       |
|                              |                                             |
+------------------------------+---------------------------------------------+
                               |
                 +-------------+-------------+
                 |                           |
                 v                           v
      +------------------+       +------------------+
      |   REST API       |       |  Supabase        |
      |   (HTTPS)        |       |  Realtime (WSS)  |
      |                  |       |                  |
      |  Agent -> Cloud  |       |  Cloud -> Agent  |
      +--------+---------+       +--------+---------+
               |                          |
               +------------+-------------+
                            |
                            v
+-----------------------------------------------------------------------------+
|                           IT DASHBOARD                                       |
|                     (Vercel + Supabase Cloud)                               |
+-----------------------------------------------------------------------------+
|                                                                             |
|  +-----------------+  +-----------------+  +-----------------+              |
|  |   Next.js App   |  |   Supabase DB   |  |   Supabase      |              |
|  |                 |  |                 |  |   Realtime      |              |
|  |  - Admin UI     |  |  - agents       |  |                 |              |
|  |  - Agent APIs   |  |  - devices      |  |  - WebSocket    |              |
|  |  - Device views |  |  - segments     |  |  - Pub/Sub      |              |
|  |  - Ping/pong    |  |  - commands     |  |  - Postgres CDC |              |
|  |                 |  |  - agent_pings  |  |                 |              |
|  +-----------------+  +-----------------+  +-----------------+              |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Technology Stack

### Why These Technologies?

| Technology | Purpose | Rationale |
|------------|---------|-----------|
| **Node.js** | Runtime | Cross-platform, excellent networking libs, same language as dashboard |
| **TypeScript** | Language | Type safety catches bugs early, better IDE support, self-documenting |
| **Express** | Local UI server | Minimal, well-understood, Socket.IO integration |
| **Socket.IO** | Local UI real-time | Reliable WebSocket abstraction for local Agent UI |
| **Supabase Client** | Cloud communication | First-party Realtime support, PostgreSQL CDC built-in |
| **Winston** | Logging | Structured logging, multiple transports, log levels |
| **node-arp** | Device discovery | Cross-platform ARP table reading |

### Why Not Alternatives?

| Rejected | Reason |
|----------|--------|
| Python | Less performant for network I/O, additional runtime dependency |
| Go | Overkill for this use case, less familiar to web developers |
| Polling only | High latency (60s+), more API calls, worse UX |
| Raw WebSockets | Supabase Realtime handles reconnection, auth, filtering |
| SQLite local DB | Adds complexity, cloud is source of truth anyway |

---

## Component Architecture

### Scanner Module (`src/scanner/`)

Responsible for discovering devices on local network segments.

```
+-------------------+
|  discover.ts      |  Orchestrates discovery process
+--------+----------+
         |
    +----+----+--------------------+
    |         |                    |
    v         v                    v
+-------+ +--------+        +------------+
|arp.ts | |ping.ts |        | oui.ts     |
+-------+ +--------+        +------------+
|       | |        |        |            |
| Read  | | Ping   |        | MAC -> OEM |
| ARP   | | sweep  |        | lookup     |
| table | | subnet |        |            |
+-------+ +--------+        +------------+
```

**Why ARP-based discovery?**
- Works on local networks without special permissions (beyond root/admin)
- Returns MAC addresses for manufacturer identification
- Fast - reads cached ARP table after ping sweep
- No false positives from routing

### Status Checker Module (`src/scanner/`)

Checks device availability using multiple protocols.

| Check Type | File | Use Case |
|------------|------|----------|
| `ping` | `ping.ts` | General availability, network devices |
| `tcp` | `tcp.ts` | Service-specific port checks |
| `http` | `http.ts` | Web services, APIs, management interfaces |

**Status Hysteresis:**
Prevents status flapping from transient network issues:
- 1st failure: Device stays online (grace period)
- 2nd consecutive failure: Device marked offline
- Recovery: Immediately online, counter reset

### Realtime Client (`src/api/realtime-client.ts`)

Manages WebSocket connection to Supabase Realtime.

**Responsibilities:**
1. Connect using credentials from heartbeat response
2. Subscribe to segment changes channel
3. Subscribe to commands channel
4. Handle connection state changes
5. Reconnect automatically on disconnect

See [REALTIME-COMMUNICATION.md](./REALTIME-COMMUNICATION.md) for details.

### Agent UI (`src/ui/`)

Local web interface for monitoring and debugging.

```
http://localhost:3001
+--------------------------------------------------+
|  IT Dashboard Agent - Office Agent               |
|  * Connected to dashboard          Version: 3.2.0|
+--------------------------------------------------+
|  Segments                                        |
|  +--------------------------------------------+ |
|  | Office LAN (192.168.1.0/24)    [Scan Now]  | |
|  | Progress: #################### 100%        | |
|  +--------------------------------------------+ |
+--------------------------------------------------+
|  Discovered Devices (12)                         |
|  +--------+---------------+----------+---------+ |
|  | Status | IP Address    | Hostname | Latency | |
|  +--------+---------------+----------+---------+ |
|  | Online | 192.168.1.1   | gateway  | 2ms     | |
|  | Online | 192.168.1.10  | server01 | 5ms     | |
|  |Offline | 192.168.1.50  | printer  | -       | |
|  +--------+---------------+----------+---------+ |
+--------------------------------------------------+
```

**Why Express + Socket.IO?**
- Minimal footprint for local-only server
- Socket.IO provides reliable real-time updates to UI
- REST API for integration with other local tools

### Upgrade Module (`src/upgrade/upgrader.ts`)

Handles agent upgrades with backup/rollback. On Windows, upgrades are orchestrated by an external PowerShell script to avoid file lock issues.

**Upgrade Flow (Windows):**
1. Agent receives upgrade command
2. Agent spawns `scripts/upgrade-service.ps1` as external process
3. Agent exits immediately (releases file handles)
4. PowerShell script:
   - Stops NSSM service
   - Backs up current installation
   - Downloads and extracts new version
   - Installs dependencies and builds
   - Restarts service

**Upgrade Flow (Linux/macOS):**
1. Download new version ZIP
2. Backup current installation
3. Extract new version
4. Install dependencies
5. Build TypeScript
6. Restart service
7. Rollback on failure

See [UPGRADE-MECHANISM.md](./UPGRADE-MECHANISM.md) for details.

---

## Data Flow

### Device Discovery Flow

```
1. Heartbeat returns segments
         |
         v
2. For each segment (by scan_interval):
         |
         v
3. Ping sweep subnet broadcast
   (populates ARP cache)
         |
         v
4. Read ARP table
   (IP -> MAC mapping)
         |
         v
5. Resolve hostnames (DNS)
         |
         v
6. Lookup manufacturer (OUI)
         |
         v
7. POST /api/agent/devices/discovered
         |
         v
8. Dashboard stores devices, broadcasts via Realtime
```

### Status Check Flow

```
1. GET /api/agent/devices
   (list of monitored devices)
         |
         v
2. For each device:
   - ping: ICMP echo
   - tcp: Port connect
   - http: HTTP request
         |
         v
3. Apply hysteresis
   (2 consecutive failures = offline)
         |
         v
4. POST /api/agent/devices/status
         |
         v
5. Dashboard updates DB, broadcasts via Realtime
```

### Ping/Pong Flow (v2.0.0)

```
Dashboard                    Supabase                      Agent
    |                           |                            |
    |--- POST /commands ------->|                            |
    |    (type: 'ping')         |                            |
    |                           |--- Realtime -------------->|
    |                           |    (new command)           |
    |                           |                            |
    |                           |<-- POST /agent/ping -------|
    |                           |    (pong response)         |
    |<-- Realtime --------------|                            |
    |    (agent_pings INSERT)   |                            |
    |                           |                            |
    v Play sonar sound          |                            v Play sonar sound
```

---

## Bidirectional Communication

### Agent -> Dashboard (REST API)

| Endpoint | Method | Purpose | Interval |
|----------|--------|---------|----------|
| `/api/agent/heartbeat` | POST | Register agent, get segments, get Supabase creds | 60s (5m if realtime connected) |
| `/api/agent/devices/discovered` | POST | Upload discovered devices from scan | Per scan |
| `/api/agent/devices/status` | POST | Upload device status reports | 30s |
| `/api/agent/devices` | GET | Get list of devices to monitor | Per status check |
| `/api/agent/segments/register` | POST | Auto-register local network segment | On startup (if no segments) |
| `/api/agent/commands/{id}/ack` | POST | Acknowledge command execution | After command |
| `/api/agent/ping` | POST | Send pong response to ping command | On ping command |

### Dashboard -> Agent (Supabase Realtime)

The agent subscribes to Supabase Realtime channels:

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
| `ping` | Dashboard "Ping" button | Send pong response, play sonar sound |
| `upgrade` | Dashboard "Upgrade" button | Download and install new version |
| `restart` | Dashboard (future) | Restart agent process |
| `update_config` | Dashboard (future) | Update runtime configuration |

---

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
- agent_id: uuid (FK -> agents)
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
- agent_id: uuid (FK -> agents)
- command_type: text ('scan_now', 'scan_segment', 'ping', 'upgrade', 'restart', 'update_config')
- payload: jsonb
- status: text ('pending', 'completed', 'failed')
- created_at: timestamptz
- executed_at: timestamptz
- error: text
```

### agent_pings
```sql
- id: uuid (PK)
- agent_id: uuid (FK -> agents)
- command_id: uuid (FK -> agent_commands)
- latency_ms: int
- created_at: timestamptz
```

### devices
```sql
- id: uuid (PK)
- segment_id: uuid (FK -> network_segments)
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

---

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
STATUS_FAILURE_THRESHOLD=2 # consecutive failures before offline
LOG_LEVEL=info            # debug, info, warn, error
ENABLE_REALTIME=true      # Enable Supabase Realtime
ENABLE_AUTO_SCAN=true     # Auto-detect local network
ENABLE_AUTO_UPGRADE=false # Auto-upgrade (opt-in)
AUTO_UPGRADE_ON_MINOR=true
```

---

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
   - onSegmentChanges -> handleSegmentChange()
   - onCommands -> handleCommand()
7. Agent is now live for instant updates
```

---

## Key Source Files

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
| `src/upgrade/upgrader.ts` | Upgrade coordination with backup/rollback |
| `src/utils/version.ts` | Centralized version management |
| `scripts/upgrade-service.ps1` | Windows external upgrade orchestrator |

---

## Fallback Mode

If Supabase Realtime is unavailable or disabled (`ENABLE_REALTIME=false`):
- Agent relies on heartbeat polling (60s interval)
- Commands received on next heartbeat
- Segment changes received on next heartbeat
- Higher latency but still functional

---

## Related Documentation

- [REALTIME-COMMUNICATION.md](./REALTIME-COMMUNICATION.md) - Detailed realtime/WebSocket guide
- [UPGRADE-MECHANISM.md](./UPGRADE-MECHANISM.md) - How agent upgrades work
- [VERSION-CONTROL.md](./VERSION-CONTROL.md) - Version policy and release process
- [E2E-TEST-RESULTS.md](./E2E-TEST-RESULTS.md) - End-to-end test results
