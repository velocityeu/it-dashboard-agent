import os from 'os'
import { loadConfig } from './config.js'
import { createLogger } from './utils/logger.js'
import { DashboardClient, type NetworkSegment, type DeviceToMonitor, type StatusReport } from './api/client.js'
import { arpScan, populateArpCache } from './scanner/arp.js'
import { pingHost } from './scanner/ping.js'
import { checkTcpPort } from './scanner/tcp.js'
import { checkHttp } from './scanner/http.js'

const VERSION = '1.0.0'

interface SegmentState {
  segment: NetworkSegment
  lastScan: number
  scanning: boolean
}

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

  // Track segment scan states
  const segmentStates = new Map<string, SegmentState>()

  // Heartbeat function
  async function sendHeartbeat(): Promise<NetworkSegment[]> {
    try {
      const hostname = os.hostname()
      const response = await client.heartbeat(VERSION, hostname)

      logger.info(`Heartbeat successful: ${response.segments.length} segments assigned`)

      // Update segment states
      for (const segment of response.segments) {
        if (!segmentStates.has(segment.id)) {
          segmentStates.set(segment.id, {
            segment,
            lastScan: 0,
            scanning: false,
          })
          logger.info(`New segment: ${segment.name} (${segment.cidr})`)
        } else {
          // Update segment config
          const state = segmentStates.get(segment.id)!
          state.segment = segment
        }
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

      // Populate ARP cache first
      await populateArpCache(segment.cidr, logger)

      // Small delay for ARP cache to populate
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Scan ARP table
      const devices = await arpScan(segment.cidr, logger)

      if (devices.length > 0) {
        logger.info(`Discovered ${devices.length} devices in ${segment.name}`)

        // Upload to dashboard
        const result = await client.uploadDiscoveredDevices(segment.id, devices)
        logger.info(`Upload result: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged`)
      } else {
        logger.info(`No devices found in ${segment.name}`)
      }

      state.lastScan = Date.now()
    } catch (error) {
      logger.error(`Segment scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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

      // Upload status reports
      if (reports.length > 0) {
        const result = await client.uploadStatusReports(reports)
        const online = reports.filter(r => r.status === 'online').length
        const offline = reports.filter(r => r.status === 'offline').length
        logger.info(`Status check complete: ${online} online, ${offline} offline, ${result.processed} processed`)
      }
    } catch (error) {
      logger.error(`Status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Main loop
  async function runLoop(): Promise<void> {
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
