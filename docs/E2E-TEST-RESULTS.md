# End-to-End Test Results

**Date:** 2026-01-28
**Agent Version:** 3.2.0
**Dashboard Version:** 0.5.0
**Dashboard:** https://it-dashboard-gray.vercel.app

## Test Summary

| Test | Description | Result |
|------|-------------|--------|
| TEST 1 | Agent -> Dashboard (Heartbeat) | PASSED |
| TEST 2 | Agent -> Dashboard (Device Discovery) | PASSED |
| TEST 3 | Agent -> Dashboard (Status Reports) | PASSED |
| TEST 4 | Dashboard -> Agent (Realtime Connection) | PASSED |
| TEST 5 | Dashboard -> Agent (Command: scan_now) | PASSED |
| TEST 6 | Dashboard -> Agent (Command: ping) | PASSED |
| TEST 7 | Dashboard -> Agent (Segment Assignment) | PASSED |
| TEST 8 | Dashboard -> Agent (Segment Update) | PASSED |
| TEST 9 | Dashboard -> Agent (Segment Removal) | PASSED |
| TEST 10 | Fallback Mode (No Realtime) | PASSED |
| TEST 11 | Upgrade System (Windows) | PASSED |
| TEST 12 | Auto-Update Enforcement | PASSED |

## New in v3.2.0 Tests

### TEST 11: Upgrade System (Windows)

**Test Scenario:** Verify the new PowerShell upgrade orchestrator works correctly.

**Test Steps:**
1. Run agent v3.1.0
2. Dashboard shows "Upgrade" button
3. Click "Upgrade to v3.2.0"
4. Observe upgrade process

**Expected Results:**
- [x] Agent spawns `upgrade-service.ps1` as external process
- [x] Agent exits immediately
- [x] `upgrade-status.json` shows progress
- [x] PowerShell script stops service
- [x] Backup created successfully
- [x] New version downloaded
- [x] `npm install && npm run build` succeeds
- [x] Files swapped
- [x] Service restarted
- [x] Agent reports v3.2.0

**Console Output:**
```
[info]: Received upgrade command
[info]: Windows detected - spawning external upgrade script
[info]: Upgrade script started, agent exiting...
```

**upgrade-status.json progression:**
```json
{"status": "starting", "message": "Starting upgrade process"}
{"status": "stopping", "message": "Stopping agent service"}
{"status": "backup", "message": "Creating backup"}
{"status": "downloading", "message": "Downloading new version"}
{"status": "extracting", "message": "Extracting archive"}
{"status": "building", "message": "Installing dependencies and building"}
{"status": "verifying", "message": "Verifying build"}
{"status": "installing", "message": "Installing new version"}
{"status": "completed", "message": "Upgrade completed successfully", "previous_version": "3.1.0", "new_version": "3.2.0"}
```

### TEST 12: Auto-Update Enforcement

**Test Scenario:** Verify dashboard auto-queues upgrade commands for outdated agents.

**Test Steps:**
1. Set `ENFORCE_AGENT_UPDATES = true` in dashboard
2. Run agent v3.1.0
3. Observe heartbeat response

**Expected Results:**
- [x] Heartbeat detects version mismatch
- [x] Dashboard auto-queues upgrade command
- [x] Command payload includes `auto_queued: true`
- [x] Agent receives upgrade command via Realtime
- [x] Upgrade proceeds automatically

**Agent Log:**
```
[info]: Heartbeat successful
[info]: Received command: upgrade (auto-queued by dashboard)
[info]: Upgrade initiated for version 3.2.0
```

---

## Previous Test Results (Verified Still Working)

### TEST 1: Agent -> Dashboard (Heartbeat)

**Console Output:**
```
2026-01-28 10:00:00 [info]: Starting IT Dashboard Agent v3.2.0
2026-01-28 10:00:00 [info]: Agent name: Home Office Agent
2026-01-28 10:00:00 [info]: Dashboard URL: https://it-dashboard-gray.vercel.app
2026-01-28 10:00:00 [info]: Agent UI running at http://localhost:3001
2026-01-28 10:00:01 [info]: Heartbeat successful: 3 segments assigned
```

**Agent UI Status API:**
```json
{
  "agentName": "Home Office Agent",
  "dashboardUrl": "https://it-dashboard-gray.vercel.app",
  "isConnected": true,
  "isRealtimeConnected": true,
  "segmentCount": 3,
  "deviceCount": 24,
  "currentVersion": "3.2.0"
}
```

### TEST 2: Agent -> Dashboard (Device Discovery)

**Console Output:**
```
2026-01-28 10:01:00 [info]: Scanning segment: HomeOffice (10.117.1.0/24)
2026-01-28 10:01:00 [info]: Segment 10.117.1.0/24 is LOCAL - using ARP discovery
2026-01-28 10:01:04 [info]: Discovered 10 devices in HomeOffice
2026-01-28 10:01:08 [info]: Upload result: 0 created, 0 updated, 10 unchanged
```

### TEST 3: Agent -> Dashboard (Status Reports)

**Console Output:**
```
2026-01-28 10:01:10 [info]: Checking status of 27 devices
2026-01-28 10:01:19 [info]: Status check complete: 20 online, 7 offline, 27 processed
```

### TEST 4: Dashboard -> Agent (Realtime Connection)

**Console Output:**
```
2026-01-28 10:00:01 [info]: Initializing Supabase Realtime connection...
2026-01-28 10:00:01 [info]: Supabase Realtime client initialized
2026-01-28 10:00:01 [info]: Connecting to Supabase Realtime...
2026-01-28 10:00:01 [info]: Supabase Realtime connected
2026-01-28 10:00:02 [info]: Subscribed to segment changes
2026-01-28 10:00:02 [info]: Subscribed to agent commands
```

### TEST 5: Dashboard -> Agent (Command: scan_now)

**Agent Log:**
```
2026-01-28 10:05:00 [info]: Received command: scan_now (abc123-uuid)
2026-01-28 10:05:00 [info]: Executing command: scan_now
2026-01-28 10:05:00 [info]: Scanning segment: HomeOffice (10.117.1.0/24)
```

### TEST 6: Dashboard -> Agent (Command: ping)

**Agent Log:**
```
2026-01-28 10:06:00 [info]: Received command: ping (def456-uuid)
2026-01-28 10:06:00 [info]: Playing sonar sound
2026-01-28 10:06:00 [info]: Sending pong response
```

---

## Configuration Used

```env
DASHBOARD_URL=https://it-dashboard-gray.vercel.app
AGENT_API_KEY=agt_McoWVe_DOfX7O07kKxKBcnudNYe-Whdp
AGENT_NAME=Home Office Agent
HEARTBEAT_INTERVAL=60
STATUS_CHECK_INTERVAL=30
LOG_LEVEL=info
```

## Dashboard Configuration

```typescript
// src/lib/constants.ts
export const APP_VERSION = '0.5.0'
export const LATEST_AGENT_VERSION = '3.2.0'
export const ENFORCE_AGENT_UPDATES = true
```

## Success Criteria Checklist

- [x] Agent connects to dashboard and shows "online"
- [x] Device discovery uploads work
- [x] Status reports upload correctly
- [x] Realtime WebSocket connects successfully
- [x] Commands from dashboard execute instantly
- [x] Segment changes propagate via realtime
- [x] Agent UI reflects all state changes in real-time
- [x] Windows upgrade system works correctly
- [x] Auto-update enforcement works
- [x] Upgrade status tracking works

## Required Supabase Configuration

### RLS Policies (Critical)

The agent uses the Supabase **anon key** for Realtime subscriptions. These RLS policies MUST exist:

**agent_commands table:**
```sql
CREATE POLICY "Anon can read commands for realtime" ON agent_commands
    FOR SELECT TO anon USING (true);
```

**network_segments table:**
```sql
CREATE POLICY "Anon can read segments for realtime" ON network_segments
    FOR SELECT TO anon USING (true);
```

**agent_pings table:**
```sql
CREATE POLICY "Anon can read pings for realtime" ON agent_pings
    FOR SELECT TO anon USING (true);
```

### Replication Settings

In Supabase Dashboard -> Database -> Replication:
- Enable replication for `network_segments` table
- Enable replication for `agent_commands` table
- Enable replication for `agent_pings` table

## Troubleshooting Guide

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Subscribed to agent commands" but no commands received | Missing RLS policy | Add anon SELECT policy to `agent_commands` |
| "Subscribed to segment changes" but no updates | Missing RLS policy | Add anon SELECT policy to `network_segments` |
| No "Supabase Realtime connected" message | Invalid credentials or firewall | Check Supabase URL/key, allow wss:// |
| Heartbeat fails | Invalid API key | Verify `AGENT_API_KEY` matches dashboard |
| Upgrade fails on Windows | File locks | Check `upgrade-status.json` and `logs/upgrade.log` |
| Upgrade stuck | PowerShell script hung | Check for running upgrade-service.ps1 processes |
