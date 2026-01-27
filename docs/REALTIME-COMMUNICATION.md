# Realtime Communication

This document explains how bidirectional realtime communication works between the IT Dashboard Agent and the cloud dashboard.

## Overview

The system uses **Supabase Realtime** for push-based communication from the dashboard to the agent. This enables:

- **Instant command execution** - No waiting for heartbeat polling
- **Immediate segment updates** - New/modified segments take effect instantly
- **Reduced latency** - Sub-second response to dashboard actions

## Architecture

```
Dashboard UI                    Supabase                     Agent
     │                             │                           │
     │  INSERT INTO agent_commands │                           │
     ├────────────────────────────►│                           │
     │                             │                           │
     │                             │  WebSocket push           │
     │                             ├──────────────────────────►│
     │                             │                           │
     │                             │                           │ Execute command
     │                             │                           │
     │                             │  POST /commands/{id}/ack  │
     │                             │◄──────────────────────────┤
     │                             │                           │
```

## Connection Establishment

### 1. Agent Startup

```typescript
// Agent sends heartbeat
POST /api/agent/heartbeat
{
  "version": "1.1.0",
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

## Command Types

| Command | Description | Payload |
|---------|-------------|---------|
| `scan_now` | Scan all segments immediately | `{}` |
| `scan_segment` | Scan specific segment | `{ segment_id: 'uuid' }` |
| `upgrade` | Upgrade agent to latest version | `{ download_url?: 'url' }` |
| `restart` | Restart agent process | `{}` |
| `update_config` | Update runtime configuration | `{ key: value, ... }` |

## Sending Commands from Dashboard

### Dashboard UI (Scan Now Button)

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

### Dashboard API

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

### Direct SQL (Testing)

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

## Command Acknowledgment

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

## Fallback Mode

When realtime is disabled or unavailable:

```env
ENABLE_REALTIME=false
```

The agent falls back to **polling via heartbeat**:

1. Heartbeat every 60 seconds
2. Dashboard includes pending commands in response
3. Agent processes commands from heartbeat response
4. Higher latency but still functional

## Heartbeat Interval Adjustment

When realtime is connected, heartbeat interval increases:

```typescript
// src/index.ts
const getHeartbeatInterval = () => {
  if (realtimeClient?.connected) {
    // Longer interval when realtime provides updates
    return Math.max(config.heartbeatInterval, 5 * 60 * 1000) // 5 minutes
  }
  return config.heartbeatInterval // 60 seconds
}
```

## Debugging Realtime

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
  "isRealtimeConnected": true,  // Should be true
  ...
}
```

## Supabase Configuration

### Required: Enable Realtime for Tables

In Supabase dashboard → Database → Replication:

1. Enable replication for `network_segments` table
2. Enable replication for `agent_commands` table

### Row Level Security (RLS)

Ensure RLS policies allow the anon key to:
- SELECT from `network_segments` (filtered by agent_id)
- SELECT from `agent_commands` (filtered by agent_id)

Example policy:
```sql
CREATE POLICY "Agents can read their segments"
ON network_segments FOR SELECT
USING (true);  -- Or more restrictive based on your auth model

CREATE POLICY "Agents can read their commands"
ON agent_commands FOR SELECT
USING (true);
```

## Troubleshooting

### Realtime Not Connecting

1. Check Supabase URL and anon key in heartbeat response
2. Verify firewall allows WebSocket connections (wss://)
3. Check Supabase project is active (not paused)

### Commands Not Received

1. Verify agent is subscribed: Look for "Subscribed to agent commands"
2. Check `agent_id` in command matches agent
3. Verify RLS policies allow SELECT on `agent_commands`
4. Check Supabase replication is enabled for `agent_commands` table

### Segment Changes Not Received

1. Verify agent is subscribed: Look for "Subscribed to segment changes"
2. Check `agent_id` on segment matches agent
3. Verify RLS policies allow SELECT on `network_segments`
4. Check Supabase replication is enabled for `network_segments` table

### High Latency

1. Check network connectivity to Supabase
2. Verify WebSocket is not being blocked/proxied
3. Consider regional Supabase project placement
