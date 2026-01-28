# Realtime Communication

**Version:** 3.2.0

This document explains how bidirectional realtime communication works between the IT Dashboard Agent and the cloud dashboard, including the rationale for choosing Supabase Realtime over alternatives.

## Table of Contents

- [Overview](#overview)
- [Why Supabase Realtime?](#why-supabase-realtime)
- [WebSocket vs Alternatives](#websocket-vs-alternatives)
- [Architecture](#architecture)
- [Connection Establishment](#connection-establishment)
- [Channel Details](#channel-details)
- [Command Types](#command-types)
- [Ping/Pong Feature](#pingpong-feature)
- [Error Handling and Reconnection](#error-handling-and-reconnection)
- [Supabase Configuration](#supabase-configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

The system uses **Supabase Realtime** for push-based communication from the dashboard to the agent. This enables:

- **Instant command execution** - No waiting for heartbeat polling
- **Immediate segment updates** - New/modified segments take effect instantly
- **Reduced latency** - Sub-second response to dashboard actions
- **Bidirectional ping/pong** - Real-time connectivity verification with sound feedback

---

## Why Supabase Realtime?

### The Problem

We needed real-time communication between:
1. **Cloud Dashboard** (Next.js on Vercel) - no persistent server
2. **Local Agent** (Node.js on customer premises) - behind firewall

Traditional approaches have limitations:
- **Polling**: High latency, wasted requests
- **Custom WebSocket server**: Additional infrastructure to maintain
- **Firebase/Pusher**: Additional service dependency, cost

### Why Supabase Realtime is the Right Choice

| Feature | Benefit |
|---------|---------|
| **Built on PostgreSQL** | Uses native LISTEN/NOTIFY, no sync issues |
| **Already using Supabase** | No additional service, one bill |
| **Automatic reconnection** | Handles network hiccups gracefully |
| **Row-level filtering** | Agent only receives its own commands |
| **Scales with infrastructure** | No separate WebSocket server to scale |
| **CDC (Change Data Capture)** | Database INSERT triggers push automatically |
| **Anon key authentication** | Simple auth model, no custom JWT flow |

### How It Works

```
1. Dashboard inserts command into agent_commands table
2. PostgreSQL emits NOTIFY event
3. Supabase Realtime broadcasts to WebSocket subscribers
4. Agent receives push in ~100-300ms
5. Agent executes command immediately
```

No polling, no custom infrastructure, no added complexity.

---

## WebSocket vs Alternatives

### Why WebSockets?

| Protocol | Pros | Cons | Verdict |
|----------|------|------|---------|
| **WebSocket** | Bidirectional, persistent, low latency | Needs connection management | **Chosen** |
| **HTTP Polling** | Simple, stateless | High latency (30-60s), wasted requests | Rejected |
| **Long Polling** | Lower latency than polling | Complex, connection timeout issues | Rejected |
| **SSE (Server-Sent Events)** | Simple server push | Server-to-client only, no bidirectional | Rejected |
| **gRPC Streaming** | Efficient, typed | Overkill, not browser-compatible | Rejected |

### WebSocket Advantages for This Use Case

1. **Low Latency** - Commands arrive in <500ms instead of waiting for next poll
2. **Bidirectional** - Both dashboard and agent can initiate communication
3. **Persistent Connection** - No TCP handshake overhead per message
4. **Efficient** - Only transfers data when there's something to send
5. **Real-time UX** - Status changes, scan progress, ping/pong all instant

### Why Not Custom WebSocket Server?

We could run our own WebSocket server, but:
- Additional infrastructure to deploy and maintain
- Need to handle authentication, reconnection, scaling
- Supabase Realtime does all this for free (included in plan)
- PostgreSQL CDC ensures data consistency

---

## Architecture

```
Dashboard UI                    Supabase                     Agent
     |                             |                           |
     |  INSERT INTO agent_commands |                           |
     +----------------------------->                           |
     |                             |                           |
     |                             |  WebSocket push           |
     |                             +---------------------------->
     |                             |                           |
     |                             |                           | Execute command
     |                             |                           |
     |                             |  POST /commands/{id}/ack  |
     |                             <----------------------------+
     |                             |                           |
```

### Connection Model

```
+-----------------+     HTTPS (outbound)      +------------------+
|                 |-------------------------->|                  |
|     Agent       |                           |    Dashboard     |
|    (Node.js)    |     WSS (outbound)        |   (Next.js +     |
|                 |-------------------------->|    Supabase)     |
+-----------------+                           +------------------+
       |                                              |
       |              WSS (persistent)                |
       +--------------------------------------------->|
                   Supabase Realtime                  |
                                                      |
```

**Key Point**: All connections are outbound from the agent. No inbound firewall rules required.

---

## Connection Establishment

### 1. Agent Startup

```typescript
// Agent sends heartbeat
POST /api/agent/heartbeat
{
  "version": "3.2.0",
  "hostname": "agent-pc",
  "uptime_seconds": 123
}
```

### 2. Dashboard Response with Credentials

```typescript
// Dashboard returns Supabase credentials
{
  "success": true,
  "agent_id": "67d7bb2e-db17-472e-bd5c-ef2473619bb5",
  "segments": [...],
  "supabase_url": "https://xxx.supabase.co",
  "supabase_anon_key": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 3. Agent Creates Supabase Client

```typescript
// src/api/realtime-client.ts
this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10, // Rate limit
    },
  },
})
```

### 4. Agent Subscribes to Channels

```typescript
// Segment changes channel
this.segmentChannel = this.supabase
  .channel(`agent:${this.agentId}:segments`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'network_segments',
    filter: `agent_id=eq.${this.agentId}`,
  }, this.handleSegmentChange)
  .subscribe()

// Commands channel
this.commandChannel = this.supabase
  .channel(`agent:${this.agentId}:commands`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'agent_commands',
    filter: `agent_id=eq.${this.agentId}`,
  }, this.handleCommand)
  .subscribe()
```

---

## Channel Details

### Segment Changes Channel

**Channel name:** `agent:{agentId}:segments`

**Table:** `network_segments`

**Events:** INSERT, UPDATE, DELETE

**Filter:** `agent_id=eq.{agentId}`

**Payload Types:**

```typescript
// INSERT - New segment assigned
{
  eventType: 'INSERT',
  new: {
    id: 'uuid',
    name: 'Office LAN',
    cidr: '192.168.1.0/24',
    scan_interval_seconds: 300
  }
}

// UPDATE - Segment config changed
{
  eventType: 'UPDATE',
  old: { ... },
  new: {
    id: 'uuid',
    scan_interval_seconds: 600  // Changed
  }
}

// DELETE - Segment removed
{
  eventType: 'DELETE',
  old: {
    id: 'uuid',
    name: 'Office LAN'
  }
}
```

### Commands Channel

**Channel name:** `agent:{agentId}:commands`

**Table:** `agent_commands`

**Events:** INSERT only

**Filter:** `agent_id=eq.{agentId}`

**Payload:**

```typescript
{
  eventType: 'INSERT',
  new: {
    id: 'command-uuid',
    command_type: 'scan_now',
    payload: {},
    status: 'pending',
    created_at: '2026-01-27T01:00:00Z'
  }
}
```

---

## Command Types

| Command | Description | Payload |
|---------|-------------|---------|
| `scan_now` | Scan all segments immediately | `{}` |
| `scan_segment` | Scan specific segment | `{ segment_id: 'uuid' }` |
| `ping` | Send pong response (v2.0.0) | `{}` |
| `upgrade` | Upgrade agent to latest version | `{ download_url?: 'url', target_version?: '3.2.0', auto_queued?: true }` |
| `restart` | Restart agent process | `{}` |
| `update_config` | Update runtime configuration | `{ key: value, ... }` |

### Sending Commands from Dashboard

**Dashboard UI (Scan Now Button):**

```typescript
// src/app/admin/agents/page.tsx
const handleScanNow = async (agentId: string) => {
  const res = await fetch(`/api/admin/agents/${agentId}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command_type: 'scan_now' }),
  })
}
```

**Dashboard API:**

```typescript
// src/app/api/admin/agents/[id]/commands/route.ts
const { data: command } = await supabase
  .from('agent_commands')
  .insert({
    agent_id: agentId,
    command_type: body.command_type,
    payload: body.payload || null,
    status: 'pending',
    created_at: new Date().toISOString(),
  })
  .select()
  .single()

// Supabase Realtime automatically pushes this to subscribed agent
```

**Direct SQL (Testing):**

```sql
INSERT INTO agent_commands (agent_id, command_type, payload, status, created_at)
VALUES (
  '67d7bb2e-db17-472e-bd5c-ef2473619bb5',
  'scan_now',
  '{}',
  'pending',
  NOW()
);
```

### Command Acknowledgment

After executing a command, the agent acknowledges it:

```typescript
// src/api/client.ts
async acknowledgeCommand(
  commandId: string,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  await this.client.post(`/api/agent/commands/${commandId}/ack`, {
    status,
    executed_at: new Date().toISOString(),
    error,
  })
}
```

---

## Ping/Pong Feature

The ping/pong feature provides instant bidirectional connectivity verification with audio feedback.

### Flow

```
Dashboard                    Supabase                      Agent
    |                           |                            |
    | Click "Ping" button       |                            |
    |                           |                            |
    |--- POST /commands ------->|                            |
    |    {type: 'ping'}         |                            |
    |                           |                            |
    |                           |--- Realtime (INSERT) ----->|
    |                           |    (agent_commands)        |
    |                           |                            |
    |                           |                    Play sonar sound
    |                           |                    Record timestamp
    |                           |                            |
    |                           |<-- POST /agent/ping -------|
    |                           |    {command_id, latency}   |
    |                           |                            |
    |                           | INSERT agent_pings         |
    |                           |                            |
    |<-- Realtime (INSERT) -----|                            |
    |    (agent_pings)          |                            |
    |                           |                            |
    | Play sonar sound          |                            |
    | Show latency              |                            |
```

### Agent Implementation

```typescript
// Handle ping command
async function handlePingCommand(command: AgentCommand) {
  const startTime = Date.now()

  // Play sonar sound locally
  playSound('sonar.mp3')

  // Send pong response
  await apiClient.post('/api/agent/ping', {
    command_id: command.id,
    latency_ms: Date.now() - startTime,
  })

  // Acknowledge command
  await apiClient.acknowledgeCommand(command.id, 'completed')
}
```

### Dashboard Implementation

```typescript
// Subscribe to agent_pings for real-time pong response
supabase
  .channel('pings')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'agent_pings',
  }, (payload) => {
    // Play sonar sound
    playSonarSound()

    // Update UI with latency
    setLatency(payload.new.latency_ms)
  })
  .subscribe()
```

### Why This Design?

1. **Immediate feedback** - Both sides hear sonar sound
2. **Latency measurement** - Know actual round-trip time
3. **Connection verification** - Confirms WebSocket + REST both work
4. **User confidence** - Audible confirmation agent is responsive

---

## Error Handling and Reconnection

### Connection States

```typescript
type ConnectionState =
  | 'connecting'    // Initial connection attempt
  | 'connected'     // Successfully connected
  | 'disconnected'  // Lost connection
  | 'reconnecting'  // Attempting to reconnect
```

### Automatic Reconnection

Supabase Realtime handles reconnection automatically:

```typescript
this.supabase = createClient(url, key, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
})

// Monitor connection state
this.supabase.realtime.on('CONNECTION_STATE_CHANGE', (state) => {
  logger.info(`Realtime connection: ${state}`)

  if (state === 'CLOSED') {
    // Will automatically attempt reconnection
    this.emit('disconnected')
  }

  if (state === 'OPEN') {
    this.emit('connected')
  }
})
```

### Reconnection Strategy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | 1s | Immediate retry |
| 2 | 2s | Quick retry |
| 3 | 4s | Backoff |
| 4+ | 8s max | Capped backoff |

### Fallback to Polling

When Realtime is unavailable:

```env
ENABLE_REALTIME=false
```

Or if connection fails persistently:

```typescript
// Fallback logic in main loop
if (!realtimeClient?.connected) {
  // Use shorter heartbeat interval
  const interval = config.heartbeatInterval // 60s

  // Commands come via heartbeat response
  const response = await apiClient.heartbeat()
  if (response.pending_commands) {
    for (const cmd of response.pending_commands) {
      await handleCommand(cmd)
    }
  }
}
```

---

## Supabase Configuration

### Required: Enable Realtime for Tables

In Supabase dashboard -> Database -> Replication:

1. Enable replication for `network_segments` table
2. Enable replication for `agent_commands` table
3. Enable replication for `agent_pings` table

### Row Level Security (RLS) - CRITICAL

The agent uses the **anon key** for Supabase Realtime subscriptions. RLS policies MUST allow the anon role to SELECT from these tables, otherwise realtime updates won't be received.

**Required policy for agent_commands:**
```sql
-- Allow anon role to SELECT agent_commands for Realtime
-- Without this, agents won't receive commands via Realtime!
CREATE POLICY "Anon can read commands for realtime" ON agent_commands
    FOR SELECT
    TO anon
    USING (true);
```

**Required policy for network_segments:**
```sql
-- Allow anon role to SELECT network_segments for Realtime
CREATE POLICY "Anon can read segments for realtime" ON network_segments
    FOR SELECT
    TO anon
    USING (true);
```

**Required policy for agent_pings:**
```sql
-- Allow anon role to SELECT agent_pings for Realtime
CREATE POLICY "Anon can read pings for realtime" ON agent_pings
    FOR SELECT
    TO anon
    USING (true);
```

**Note:** These policies allow reading only. Command acknowledgment and other writes use the service_role key via the dashboard API.

---

## Troubleshooting

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Expected Log Messages

**Successful Connection:**
```
[info]: Initializing Supabase Realtime connection...
[info]: Supabase Realtime client initialized
[info]: Connecting to Supabase Realtime...
[info]: Supabase Realtime connected
[debug]: Segment channel status: SUBSCRIBED
[info]: Subscribed to segment changes
[debug]: Command channel status: SUBSCRIBED
[info]: Subscribed to agent commands
```

**Command Received:**
```
[info]: Received command: scan_now (abc123-uuid)
[info]: Scanning segment: HomeOffice (10.117.1.0/24)
```

**Ping Received:**
```
[info]: Received command: ping (def456-uuid)
[info]: Playing sonar sound
[info]: Sending pong response
```

**Segment Change Received:**
```
[info]: Realtime segment change: INSERT
[info]: New segment via realtime: Office LAN (192.168.1.0/24)
```

### Agent UI Status

Check `http://localhost:3001/api/status`:

```json
{
  "isConnected": true,
  "isRealtimeConnected": true,
  "version": "3.2.0",
  ...
}
```

### Common Issues

#### Realtime Not Connecting

1. Check Supabase URL and anon key in heartbeat response
2. Verify firewall allows WebSocket connections (wss://)
3. Check Supabase project is active (not paused)

#### Commands Not Received

1. Verify agent is subscribed: Look for "Subscribed to agent commands"
2. Check `agent_id` in command matches agent
3. Verify RLS policies allow SELECT on `agent_commands`
4. Check Supabase replication is enabled for `agent_commands` table

#### Segment Changes Not Received

1. Verify agent is subscribed: Look for "Subscribed to segment changes"
2. Check `agent_id` on segment matches agent
3. Verify RLS policies allow SELECT on `network_segments`
4. Check Supabase replication is enabled for `network_segments` table

#### Ping/Pong Not Working

1. Check agent is receiving `ping` command (logs)
2. Verify `/api/agent/ping` endpoint is accessible
3. Check `agent_pings` table has RLS policy for anon SELECT
4. Check dashboard is subscribed to `agent_pings` changes

#### High Latency

1. Check network connectivity to Supabase
2. Verify WebSocket is not being blocked/proxied
3. Consider regional Supabase project placement

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full system architecture
- [UPGRADE-MECHANISM.md](./UPGRADE-MECHANISM.md) - How agent upgrades work
- [VERSION-CONTROL.md](./VERSION-CONTROL.md) - Version policy and release process
