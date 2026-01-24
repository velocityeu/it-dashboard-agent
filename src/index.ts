import os from 'os'
import { loadConfig } from './config.js'
import { createLogger } from './utils/logger.js'
import { DashboardClient, type NetworkSegment, type DeviceToMonitor, type StatusReport } from './api/client.js'
import { discoverDevices, type DiscoveredDevice } from './scanner/discover.js'
import { pingHost } from './scanner/ping.js'
import { checkTcpPort } from './scanner/tcp.js'
import { checkHttp } from './scanner/http.js'
import { AgentUI } from './ui/server.js'

const VERSION = '1.0.0'

interface SegmentState {
  segment: NetworkSegment
  lastScan: number
  scanning: boolean
}

// Track consecutive failures for status hysteresis
// Device only goes offline after FAILURE_THRESHOLD consecutive failures
const FAILURE_THRESHOLD = 2
const deviceFailureCounts = new Map<string, number>()
const lastKnownStatus = new Map<string, 'online' | 'offline' | 'degraded' | 'unknown'>()

async function main() {
  console.log(`
╔════════════════════════════════════════════╗
║     IT Dashboard Agent v${VERSION}            ║
║     Network Discovery & Monitoring         ║
╚════════════════════════════════════════════╝
`)

  // Load configuration
  const config = loadConfig()
  const logger = createLogger(config.logLevel)

  logger.info(`Starting IT Dashboard Agent v${VERSION}`)
  logger.info(`Agent name: ${config.agentName}`)
  logger.info(`Dashboard URL: ${config.dashboardUrl}`)

  // Create dashboard client
  const client = new DashboardClient(config.dashboardUrl, config.apiKey, logger)

  // Create Agent UI server
  const ui = new AgentUI(logger, config.agentName, config.dashboardUrl)

  // Track segment scan states
  const segmentStates = new Map<string, SegmentState>()

  // Track all discovered devices for UI
  const allDiscoveredDevices: DiscoveredDevice[] = []

  // Heartbeat function
  async function sendHeartbeat(): Promise<NetworkSegment[]> {
    try {
      const hostname = os.hostname()
      const response = await client.heartbeat(VERSION, hostname)

      logger.info(`Heartbeat successful: ${response.segments.length} segments assigned`)

      // Update UI
      ui.updateConnectionStatus(true)
      ui.updateHeartbeat()
      ui.addLog('info', `Heartbeat: ${response.segments.length} segments`)

      // Update segment states
      for (const segment of response.segments) {
        if (!segmentStates.has(segment.id)) {
          segmentStates.set(segment.id, {
            segment,
            lastScan: 0,
            scanning: false,
          })
          logger.info(`New segment: ${segment.name} (${segment.cidr})`)
          ui.addLog('info', `New segment: ${segment.name}`)
        } else {
          // Update segment config
          const state = segmentStates.get(segment.id)!
          state.segment = segment
        }
      }

      // Update UI with segments
      ui.updateSegments(response.segments)

      // Set up scan callbacks for UI
      for (const segment of response.segments) {
        ui.setScanCallback(segment.id, async () => {
          const state = segmentStates.get(segment.id)
          if (state) {
            await scanSegment(state)
          }
        })
      }

      // Remove segments no longer assigned
      for (const [id] of segmentStates) {
        if (!response.segments.find(s => s.id === id)) {
          segmentStates.delete(id)
          logger.info(`Segment removed: ${id}`)
        }
      }

      return response.segments
    } catch (error) {
      logger.error(`Heartbeat failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ui.updateConnectionStatus(false)
      ui.addLog('error', `Heartbeat failed: ${error instanceof Error ? error.message : 'Unknown'}`)
      return []
    }
  }

  // Scan a network segment
  async function scanSegment(state: SegmentState): Promise<void> {
    if (state.scanning) {
      logger.debug(`Segment ${state.segment.name} already scanning, skipping`)
      return
    }

    state.scanning = true
    const { segment } = state

    try {
      logger.info(`Scanning segment: ${segment.name} (${segment.cidr})`)
      ui.updateScanProgress(segment.id, 10, true)
      ui.addLog('info', `Scanning: ${segment.name}`)

      // Discover devices - automatically uses ARP for local or ping sweep for remote
      const devices = await discoverDevices(segment.cidr, logger)
      ui.updateScanProgress(segment.id, 80, true)

      if (devices.length > 0) {
        logger.info(`Discovered ${devices.length} devices in ${segment.name}`)
        ui.addLog('info', `Found ${devices.length} devices in ${segment.name}`)

        // Update UI with discovered devices
        ui.updateDevices(devices)

        // Upload to dashboard
        const result = await client.uploadDiscoveredDevices(segment.id, devices)
        logger.info(`Upload result: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`)
        ui.addLog('info', `Uploaded: ${result.created} new, ${result.updated} updated`)
      } else {
        logger.info(`No devices found in ${segment.name}`)
        ui.addLog('warn', `No devices in ${segment.name}`)
      }

      state.lastScan = Date.now()
      ui.updateScanProgress(segment.id, 100, false)
    } catch (error) {
      logger.error(`Segment scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ui.addLog('error', `Scan failed: ${error instanceof Error ? error.message : 'Unknown'}`)
      ui.updateScanProgress(segment.id, 0, false)
    } finally {
      state.scanning = false
    }
  }

  // Check device status
  async function checkDeviceStatus(device: DeviceToMonitor): Promise<StatusReport> {
    const checkedAt = new Date().toISOString()

    try {
      if (device.check_type === 'http' && device.url) {
        const result = await checkHttp(device.url, logger)
        return {
          device_id: device.id,
          ip_address: device.ip_address || '',
          status: result.status,
          response_time_ms: result.response_time_ms,
          check_type: 'http',
          checked_at: checkedAt,
          error: result.error,
        }
      } else if (device.check_type === 'tcp' && device.ip_address && device.port) {
        const result = await checkTcpPort(device.ip_address, device.port, logger)
        return {
          device_id: device.id,
          ip_address: device.ip_address,
          status: result.status,
          response_time_ms: result.response_time_ms,
          check_type: 'tcp',
          checked_at: checkedAt,
          error: result.error,
        }
      } else if (device.ip_address) {
        // Default to ping
        const result = await pingHost(device.ip_address, logger)
        return {
          device_id: device.id,
          ip_address: device.ip_address,
          status: result.status,
          response_time_ms: result.response_time_ms,
          check_type: 'ping',
          checked_at: checkedAt,
          error: result.error,
        }
      } else {
        return {
          device_id: device.id,
          ip_address: device.ip_address || '',
          status: 'unknown',
          response_time_ms: null,
          check_type: device.check_type,
          checked_at: checkedAt,
          error: 'No IP address or URL configured',
        }
      }
    } catch (error) {
      return {
        device_id: device.id,
        ip_address: device.ip_address || '',
        status: 'offline',
        response_time_ms: null,
        check_type: device.check_type,
        checked_at: checkedAt,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Run status checks for monitored devices
  async function runStatusChecks(): Promise<void> {
    try {
      const devices = await client.getDevicesToMonitor()

      if (devices.length === 0) {
        logger.debug('No devices to monitor')
        return
      }

      logger.info(`Checking status of ${devices.length} devices`)

      const reports: StatusReport[] = []

      // Check devices with concurrency limit
      const concurrency = 10
      const queue = [...devices]

      const workers = Array(Math.min(concurrency, queue.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0) {
            const device = queue.shift()
            if (device) {
              const report = await checkDeviceStatus(device)
              reports.push(report)
            }
          }
        })

      await Promise.all(workers)

      // Apply status hysteresis to prevent rapid flapping
      // Device only goes offline after FAILURE_THRESHOLD consecutive failures
      const stabilizedReports = reports.map(report => {
        const deviceKey = report.ip_address // Use ip_address as key (always present)
        const rawStatus = report.status

        if (rawStatus === 'online') {
          // Device is responding - reset failure count
          deviceFailureCounts.set(deviceKey, 0)
          lastKnownStatus.set(deviceKey, 'online')
          return report
        } else if (rawStatus === 'offline' || rawStatus === 'degraded') {
          // Device failed check - increment failure count
          const currentFailures = (deviceFailureCounts.get(deviceKey) || 0) + 1
          deviceFailureCounts.set(deviceKey, currentFailures)

          const previousStatus = lastKnownStatus.get(deviceKey)

          if (currentFailures < FAILURE_THRESHOLD && previousStatus === 'online') {
            // Not enough consecutive failures - keep as online
            logger.debug(`Device ${report.ip_address}: ${rawStatus} (failure ${currentFailures}/${FAILURE_THRESHOLD}, keeping online)`)
            return { ...report, status: 'online' as const }
          } else {
            // Enough failures - accept offline status
            if (previousStatus !== rawStatus) {
              logger.info(`Device ${report.ip_address}: status changed ${previousStatus || 'unknown'} → ${rawStatus} (after ${currentFailures} failures)`)
            }
            lastKnownStatus.set(deviceKey, rawStatus)
            return report
          }
        }

        // For 'unknown' status, just pass through
        return report
      })

      // Upload stabilized status reports
      if (stabilizedReports.length > 0) {
        const result = await client.uploadStatusReports(stabilizedReports)
        const online = stabilizedReports.filter(r => r.status === 'online').length
        const offline = stabilizedReports.filter(r => r.status === 'offline').length
        logger.info(`Status check complete: ${online} online, ${offline} offline, ${result.processed} processed`)

        // Update Agent UI with status
        const statusUpdates = stabilizedReports.map(r => ({
          ip_address: r.ip_address,
          status: r.status as 'online' | 'offline' | 'degraded' | 'unknown',
          response_time_ms: r.response_time_ms,
          last_check: new Date(r.checked_at),
          error: r.error
        }))
        ui.updateDeviceStatuses(statusUpdates)
        ui.addLog('info', `Status: ${online} online, ${offline} offline`)
      }
    } catch (error) {
      logger.error(`Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ui.addLog('error', `Status check failed: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
  }

  // Main loop
  async function runLoop(): Promise<void> {
    // Start Agent UI server
    await ui.start(3001)

    // Initial heartbeat
    await sendHeartbeat()

    // Start heartbeat interval
    setInterval(async () => {
      await sendHeartbeat()
    }, config.heartbeatInterval)

    // Start status check interval
    setInterval(async () => {
      await runStatusChecks()
    }, config.statusCheckInterval)

    // Run initial status check
    await runStatusChecks()

    // Segment scan loop (check every 10 seconds if any segment needs scanning)
    setInterval(async () => {
      const now = Date.now()

      for (const [, state] of segmentStates) {
        const interval = state.segment.scan_interval_seconds * 1000
        const timeSinceLastScan = now - state.lastScan

        if (timeSinceLastScan >= interval) {
          // Don't await, let scans run in background
          scanSegment(state).catch(err => {
            logger.error(`Segment scan error: ${err}`)
          })
        }
      }
    }, 10000)

    // Run initial segment scans
    for (const [, state] of segmentStates) {
      scanSegment(state).catch(err => {
        logger.error(`Initial scan error: ${err}`)
      })
    }

    logger.info('Agent running. Press Ctrl+C to stop.')
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...')
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    logger.info('Shutting down...')
    process.exit(0)
  })

  // Start the agent
  try {
    await runLoop()
  } catch (error) {
    logger.error(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    process.exit(1)
  }
}

// Run main
main().catch(error => {
  console.error('Failed to start agent:', error)
  process.exit(1)
})
