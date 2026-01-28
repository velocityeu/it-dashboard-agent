# Changelog

All notable changes to the IT Dashboard Agent will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.7] - 2026-01-28

### Fixed
- **Critical**: VERSION constant in version.ts not updated during version bump, causing infinite upgrade loop

## [3.2.6] - 2026-01-28

### Changed
- Documentation updates for v3.2.5 features

## [3.2.5] - 2026-01-28

### Added
- **Configurable Failure Threshold**: `STATUS_FAILURE_THRESHOLD` env var to customize hysteresis (default: 2)

### Changed
- **Segment-Aware Device Tracking**: UI now tracks which segment each device belongs to
- Device cleanup only removes devices from removed segments (not all devices)
- More accurate device count per segment in UI

## [3.2.4] - 2026-01-28

### Added
- **Heartbeat Command Fallback**: Pending commands now included in heartbeat response as backup delivery when realtime is down
- Agent processes pending commands from heartbeat when realtime is disconnected

### Changed
- **Stale Connection Threshold**: Increased from 2 minutes to 10 minutes to reduce unnecessary reconnects during quiet periods
- **Device Tracking Key**: Now uses `device_id` instead of IP address for more accurate status tracking across IP changes

### Fixed
- Commands not delivered when Supabase Realtime temporarily disconnects
- Device status tracking issues when devices change IP addresses

## [3.2.3] - 2026-01-28

### Fixed
- Auto-download upgrade script if missing on older installations

## [3.2.2] - 2026-01-28

### Changed
- Version bump for production testing (contains all 3.2.1 fixes)

## [3.2.1] - 2026-01-28

### Fixed
- **Ping not working on first attempt**: Socket.IO connections now have proper ping/timeout configuration
- **Status not updating in realtime**: Heartbeat interval capped at 60 seconds (was 5+ minutes when realtime connected)
- **Silent connection timeouts**: Added robust reconnection strategy with exponential backoff
- **Supabase realtime false positive connections**: Now tracks actual subscription state before reporting connected
- **Memory leak from stale device data**: Device statuses cleaned up when segments are removed

### Added
- Socket.IO server configuration: 15s ping interval, 45s timeout, 10s connect timeout
- Client reconnection with infinite retries and 1-5 second exponential backoff
- UI socket connection indicator showing connected/disconnected/reconnecting status
- Heartbeat retry logic with 2s, 5s, 10s delays on failure
- Supabase realtime health checks detecting stale connections (2 minute threshold)
- `isHealthy()` method on realtime client for connection quality checks
- Periodic client-side health check forcing reconnect on stale connections

### Changed
- Heartbeat interval now capped at 60 seconds maximum for reliability
- Realtime client only reports connected when both channels are actually subscribed
- All socket message handlers track last message timestamp for staleness detection

## [3.2.0] - 2026-01-28

### Added
- External PowerShell upgrade orchestrator (`scripts/upgrade-service.ps1`)
  - Solves Windows file lock issues during self-update
  - Agent spawns script and exits immediately
  - Script handles service stop, backup, download, build, and restart
- Upgrade status tracking via `upgrade-status.json`
  - Real-time progress monitoring
  - Status values: starting, stopping, backup, downloading, extracting, building, verifying, installing, completed, failed, rolled_back
- Detailed upgrade logging to `logs/upgrade.log`
- Development mode support in upgrade script
  - Gracefully handles missing NSSM service
  - Skips service stop/start when no service exists

### Changed
- Upgrade command on Windows now spawns external script instead of in-process upgrade
- Installer stops service before upgrade mode to release file handles
- Port check skipped in upgrade mode

### Fixed
- File lock issues during Windows upgrades
- Service restart reliability after upgrades
- Upgrade failures when node_modules locked

## [3.1.0] - 2026-01-27

### Changed
- Improved log clarity and error handling messages throughout
- Better error messages for common failure scenarios

## [3.0.0] - 2026-01-26

### Added
- **Log Rotation**: Automatic daily log rotation with 7-day retention and gzip compression
- **Toast Notifications**: Non-blocking notifications replace browser alerts in dashboard
- **Ping All Online Agents**: Dashboard ping button now pings all online agents in parallel
- **Individual Ping Buttons**: Each agent card has a dedicated Ping button
- **Improved Installer**: Pre-packaged NSSM binary, prerequisite checks (Windows version, disk space, port availability)
- **Offline Installation**: Create air-gapped bundles for installations without internet
- **Upgrade Retry Logic**: 3 retries with 5-second delays for failed downloads
- **Pre-built Releases**: GitHub releases include node_modules for faster installation

### Changed
- Winston logger now uses daily rotate file transport
- Installer checks prerequisites before attempting installation

## [2.0.0] - 2026-01-20

### Added
- **Bidirectional Realtime Communication**: Full WebSocket support via Supabase Realtime
- **Ping/Pong Feature**: Connectivity verification with sonar sound feedback
- **Agent Commands**: Dashboard can send commands (scan_now, ping, upgrade) to agents
- **Segment Change Notifications**: Real-time updates when segments are added/modified/removed

### Changed
- Heartbeat interval extended to 5 minutes when Realtime is connected
- Command execution is now instant via WebSocket instead of polling

## [1.1.0] - 2026-01-15

### Added
- Status hysteresis to prevent rapid status flapping
- Consecutive failure threshold (2 failures before marking offline)
- Agent UI improvements with better status display

### Fixed
- Devices incorrectly marked offline after single failed check
- Status flapping on unstable networks

## [1.0.0] - 2026-01-10

### Added
- Initial release
- Device discovery via ARP scanning
- Status monitoring (ping, TCP, HTTP checks)
- Dashboard REST API integration
- Agent UI on port 3001
- Windows service installation via NSSM
- Linux/macOS service installation via systemd/launchd
- Basic upgrade mechanism with backup/rollback
