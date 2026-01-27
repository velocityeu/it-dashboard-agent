import os from 'os'
import { loadConfig } from './config.js'
import { createLogger } from './utils/logger.js'
import { VERSION, shouldAutoUpgrade } from './utils/version.js'
import { DashboardClient, type NetworkSegment, type DeviceToMonitor, type StatusReport, type AgentCommand, type HeartbeatResponse } from './api/client.js'
import { RealtimeClient, type SegmentChangePayload } from './api/realtime-client.js'
import { discoverDevices, type DiscoveredDevice } from './scanner/discover.js'
import { pingHost } from './scanner/ping.js'
import { checkTcpPort } from './scanner/tcp.js'
import { checkHttp } from './scanner/http.js'
import { AgentUI } from './ui/server.js'
import { getPrimaryLocalNetwork, generateAutoSegmentName, type LocalNetwork } from './utils/network-detect.js'
import { AgentUpgrader, getInstallPath } from './upgrade/upgrader.js'

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

  // Realtime client and agent state
  let realtimeClient: RealtimeClient | null = null
  let agentId: string | null = null
  let supabaseCredentials: { url: string; anonKey: string } | null = null

  // Auto-registered segment tracking
  let autoRegisteredSegment: NetworkSegment | null = null

  /**
   * Auto-detect local network and register segment with dashboard
   */
  async function autoRegisterLocalNetwork(): Promise<NetworkSegment | null> {
    if (!config.enableAutoScan) {
      logger.debug('Auto-scan disabled')
      return null
    }

    logger.info('No segments assigned - detecting local network for auto-scan...')
    ui.addLog('info', 'Detecting local network...')

    const primaryNetwork = getPrimaryLocalNetwork()

    if (!primaryNetwork) {
      logger.warn('Could not detect local network for auto-scan')
      ui.addLog('warn', 'No local network detected')
      return null
    }

    logger.info(`Detected local network: ${primaryNetwork.cidr} on ${primaryNetwork.interfaceName}`)
    ui.addLog('info', `Found: ${primaryNetwork.cidr} (${primaryNetwork.interfaceName})`)

    try {
      const segmentName = generateAutoSegmentName(primaryNetwork)
      const segment = await client.registerAutoSegment({
        cidr: primaryNetwork.cidr,
        name: segmentName,
        interface_name: primaryNetwork.interfaceName,
      })

      logger.info(`Auto-registered segment: ${segment.name} (${segment.id})`)
      ui.addLog('info', `Registered: ${segment.name}`)

      return segment
    } catch (error) {
      logger.error(`Failed to register auto-segment: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ui.addLog('error', `Auto-register failed: ${error instanceof Error ? error.message : 'Unknown'}`)
      return null
    }
  }

  /**
   * Initialize Supabase Realtime connection
   */
  async function initializeRealtime(url: string, anonKey: string): Promise<void> {
    if (!config.enableRealtime) {
      logger.info('Realtime disabled by configuration')
      return
    }

    if (!agentId) {
      logger.warn('Cannot initialize realtime: no agent ID')
      return
    }

    // Skip if already connected with same credentials
    if (realtimeClient?.connected && supabaseCredentials?.url === url) {
      return
    }

    logger.info('Initializing Supabase Realtime connection...')
    ui.addLog('info', 'Connecting to realtime...')

    try {
      // Disconnect existing client if any
      if (realtimeClient) {
        await realtimeClient.disconnect()
      }

      realtimeClient = new RealtimeClient({ supabaseUrl: url, supabaseAnonKey: anonKey, agentId }, logger)

      // Set up callbacks
      realtimeClient.onSegmentChanges(handleSegmentChange)
      realtimeClient.onCommands(handleCommand)
      realtimeClient.onConnection((status) => {
        ui.updateRealtimeStatus(status === 'connected')
        if (status === 'connected') {
          ui.addLog('info', 'Realtime connected')
        } else if (status === 'disconnected') {
          ui.addLog('warn', 'Realtime disconnected')
        } else {
          ui.addLog('error', 'Realtime connection error')
        }
      })

      await realtimeClient.connect()
      supabaseCredentials = { url, anonKey }

    } catch (error) {
      logger.error(`Realtime initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      ui.addLog('error', `Realtime failed: ${error instanceof Error ? error.message : 'Unknown'}`)
      realtimeClient = null
    }
  }

  /**
   * Handle segment changes from Supabase Realtime
   */
  function handleSegmentChange(payload: SegmentChangePayload): void {
    logger.info(`Realtime segment change: ${payload.eventType}`)

    if (payload.eventType === 'INSERT' && payload.new) {
      // New segment assigned
      const segment = payload.new
      if (!segmentStates.has(segment.id)) {
        segmentStates.set(segment.id, {
          segment,
          lastScan: 0,
          scanning: false,
        })
        logger.info(`New segment via realtime: ${segment.name} (${segment.cidr})`)
        ui.addLog('info', `New segment: ${segment.name}`)
        ui.updateSegments(Array.from(segmentStates.values()).map(s => s.segment))

        // Register scan callback
        ui.setScanCallback(segment.id, async () => {
          const state = segmentStates.get(segment.id)
          if (state) await scanSegment(state)
        })

        // Trigger immediate scan
        const state = segmentStates.get(segment.id)
        if (state) {
          scanSegment(state).catch(err => {
            const errMsg = err instanceof Error ? err.message : String(err)
            logger.error(`[REALTIME] Scan failed for new segment '${segment.name}': ${errMsg}`)
          })
        }
      }
    } else if (payload.eventType === 'UPDATE' && payload.new) {
      // Segment updated
      const segment = payload.new
      const state = segmentStates.get(segment.id)
      if (state) {
        state.segment = segment
        logger.info(`Segment updated via realtime: ${segment.name}`)
        ui.addLog('info', `Segment updated: ${segment.name}`)
        ui.updateSegments(Array.from(segmentStates.values()).map(s => s.segment))
      }
    } else if (payload.eventType === 'DELETE' && payload.old) {
      // Segment removed
      const segmentId = payload.old.id
      if (segmentStates.has(segmentId)) {
        segmentStates.delete(segmentId)
        logger.info(`Segment removed via realtime: ${payload.old.name}`)
        ui.addLog('info', `Segment removed: ${payload.old.name}`)
        ui.updateSegments(Array.from(segmentStates.values()).map(s => s.segment))
      }
    }
  }

  /**
   * Handle commands from Supabase Realtime
   */
  async function handleCommand(command: AgentCommand): Promise<void> {
    logger.info(`[COMMAND] Received '${command.command_type}' (id: ${command.id}) - executing`)
    ui.addLog('info', `Command: ${command.command_type}`)

    try {
      switch (command.command_type) {
        case 'scan_now':
          // Scan all segments
          logger.info(`[COMMAND:scan_now] Starting immediate scan of ${segmentStates.size} segment(s)`)
          for (const [, state] of segmentStates) {
            scanSegment(state).catch(err => {
              const errMsg = err instanceof Error ? err.message : String(err)
              logger.error(`[COMMAND:scan_now] Scan failed for segment '${state.segment.name}': ${errMsg}`)
            })
          }
          break

        case 'scan_segment':
          // Scan specific segment
          const segmentId = command.payload?.segment_id as string
          if (segmentId) {
            const state = segmentStates.get(segmentId)
            if (state) {
              logger.info(`[COMMAND:scan_segment] Scanning segment '${state.segment.name}' (${state.segment.cidr})`)
              await scanSegment(state)
            } else {
              logger.warn(`[COMMAND:scan_segment] Segment not found: ${segmentId}`)
              throw new Error(`Segment not found: ${segmentId}. Available segments: ${Array.from(segmentStates.keys()).join(', ') || 'none'}`)
            }
          }
          break

        case 'update_config':
          // Configuration updates (future)
          logger.info('[COMMAND:update_config] Config update received (not implemented)')
          break

        case 'restart':
          // Agent restart request
          logger.info('[COMMAND:restart] Restart requested - shutting down for service manager restart')
          ui.addLog('warn', 'Restarting agent...')
          await client.acknowledgeCommand(command.id, 'completed')
          process.exit(0) // Exit for process manager to restart
          break

        case 'upgrade':
          // Agent upgrade request
          const targetVersion = command.payload?.target_version as string | undefined
          logger.info(`[COMMAND:upgrade] Upgrade requested${targetVersion ? ` to version ${targetVersion}` : ' to latest version'}`)
          ui.addLog('info', 'Starting upgrade...')

          try {
            // Get the download URL from the command payload or use a default
            const downloadUrl = (command.payload?.download_url as string) ||
              'https://github.com/velocityeu/it-dashboard-agent/archive/refs/heads/master.zip'

            logger.info(`[COMMAND:upgrade] Download URL: ${downloadUrl}`)
            const upgrader = new AgentUpgrader(getInstallPath(), downloadUrl, logger)
            const result = await upgrader.upgrade()

            if (result.success) {
              logger.info(`[COMMAND:upgrade] Upgrade successful: v${result.previousVersion} -> v${result.newVersion}`)
              ui.addLog('info', `Upgraded to v${result.newVersion}`)
              await client.acknowledgeCommand(command.id, 'completed')
              // Exit so service manager restarts with new version
              process.exit(0)
            } else {
              throw new Error(result.error || 'Upgrade failed')
            }
          } catch (upgradeError) {
            const errorMsg = upgradeError instanceof Error ? upgradeError.message : String(upgradeError)
            logger.error(`[COMMAND:upgrade] Upgrade failed: ${errorMsg}`)
            ui.addLog('error', `Upgrade failed: ${errorMsg}`)
            await client.acknowledgeCommand(command.id, 'failed', errorMsg)
          }
          break

        case 'ping':
          // Ping from dashboard - show visual/audio feedback
          logger.info('[COMMAND:ping] Ping received from dashboard - responding with visual/audio feedback')
          ui.addLog('info', 'Ping received from dashboard')
          ui.showPingReceived()
          break

        default:
          logger.warn(`[COMMAND] Unknown command type: '${command.command_type}' - ignoring`)
      }

      await client.acknowledgeCommand(command.id, 'completed')
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`[COMMAND:${command.command_type}] Execution failed: ${errorMsg}`)
      await client.acknowledgeCommand(command.id, 'failed', errorMsg)
    }
  }

  /**
   * Perform auto-upgrade when a new version is available
   */
  async function performAutoUpgrade(downloadUrl: string, newVersion: string): Promise<void> {
    try {
      const upgrader = new AgentUpgrader(getInstallPath(), downloadUrl, logger)
      const result = await upgrader.upgrade()

      if (result.success) {
        logger.info(`Auto-upgrade successful: ${result.previousVersion} -> ${result.newVersion}`)
        ui.addLog('info', `Auto-upgraded to v${result.newVersion}`)
        // Exit so service manager restarts with new version
        process.exit(0)
      } else {
        throw new Error(result.error || 'Auto-upgrade failed')
      }
    } catch (error) {
      logger.error(`Auto-upgrade failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  }

  // Heartbeat function
  async function sendHeartbeat(): Promise<NetworkSegment[]> {
    try {
      const hostname = os.hostname()
      const response = await client.heartbeat(VERSION, hostname)

      // Store agent ID for realtime subscription
      if (response.agent_id && response.agent_id !== agentId) {
        agentId = response.agent_id
        logger.debug(`Agent ID: ${agentId}`)

        // Update realtime client with new agent ID
        if (realtimeClient) {
          await realtimeClient.updateAgentId(agentId)
        }
      }

      logger.info(`Heartbeat successful: ${response.segments.length} segments assigned`)

      // Update UI
      ui.updateConnectionStatus(true)
      ui.updateHeartbeat()
      ui.addLog('info', `Heartbeat: ${response.segments.length} segments`)

      // Initialize Supabase Realtime if credentials provided
      const supabaseUrl = response.supabase_url || config.supabaseUrl
      const supabaseKey = response.supabase_anon_key || config.supabaseAnonKey

      if (supabaseUrl && supabaseKey && agentId && config.enableRealtime) {
        // Initialize in background, don't block heartbeat
        initializeRealtime(supabaseUrl, supabaseKey).catch(err => {
          logger.error(`Realtime init failed: ${err}`)
        })
      }

      // Update UI with version info
      ui.updateVersionInfo(VERSION, response.latest_agent_version, response.upgrade_available)

      // Check for auto-upgrade
      if (response.upgrade_available && config.enableAutoUpgrade && response.agent_download_url) {
        const latestVersion = response.latest_agent_version || '0.0.0'
        if (shouldAutoUpgrade(latestVersion, VERSION, config.autoUpgradeOnMinor)) {
          logger.info(`Auto-upgrade triggered: ${VERSION} -> ${latestVersion}`)
          ui.addLog('info', `Auto-upgrading to v${latestVersion}...`)

          // Perform upgrade in background
          performAutoUpgrade(response.agent_download_url, latestVersion).catch(err => {
            logger.error(`Auto-upgrade failed: ${err}`)
            ui.addLog('error', `Auto-upgrade failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
          })
        } else {
          logger.debug(`Upgrade available (v${latestVersion}) but not auto-upgrading (major version change or disabled)`)
        }
      }

      // Handle auto-scan when no segments assigned
      let segments = response.segments
      if (segments.length === 0 && config.enableAutoScan && !autoRegisteredSegment) {
        const autoSegment = await autoRegisterLocalNetwork()
        if (autoSegment) {
          autoRegisteredSegment = autoSegment
          segments = [autoSegment]
        }
      }

      // Update segment states
      for (const segment of segments) {
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
      ui.updateSegments(segments)

      // Set up scan callbacks for UI
      for (const segment of segments) {
        ui.setScanCallback(segment.id, async () => {
          const state = segmentStates.get(segment.id)
          if (state) {
            await scanSegment(state)
          }
        })
      }

      // Remove segments no longer assigned (unless it's our auto-registered one)
      for (const [id] of segmentStates) {
        const stillAssigned = segments.find(s => s.id === id)
        const isOurAutoSegment = autoRegisteredSegment?.id === id
        if (!stillAssigned && !isOurAutoSegment) {
          segmentStates.delete(id)
          logger.info(`Segment removed: ${id}`)
        }
      }

      return segments
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

    // Set up ping dashboard callback
    ui.setPingDashboardCallback(async () => {
      try {
        await client.pingDashboard()
        logger.info('Ping sent to dashboard')
        ui.addLog('info', 'Ping sent to dashboard')
      } catch (error) {
        logger.error(`Failed to ping dashboard: ${error instanceof Error ? error.message : 'Unknown'}`)
        ui.addLog('error', 'Failed to ping dashboard')
      }
    })

    // Initial heartbeat
    await sendHeartbeat()

    // Heartbeat interval - longer when realtime is connected (fallback only)
    // When realtime is working, heartbeat is just for keepalive and credential refresh
    const getHeartbeatInterval = () => {
      if (realtimeClient?.connected) {
        // Use longer interval when realtime is providing updates
        return Math.max(config.heartbeatInterval, 5 * 60 * 1000) // At least 5 minutes
      }
      return config.heartbeatInterval
    }

    // Dynamic heartbeat - check interval each time
    const scheduleHeartbeat = () => {
      setTimeout(async () => {
        await sendHeartbeat()
        scheduleHeartbeat() // Reschedule with potentially new interval
      }, getHeartbeatInterval())
    }
    scheduleHeartbeat()

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
            const errMsg = err instanceof Error ? err.message : String(err)
            logger.error(`[SCAN] Scheduled scan failed for segment '${state.segment.name}': ${errMsg}`)
          })
        }
      }
    }, 10000)

    // Run initial segment scans
    for (const [, state] of segmentStates) {
      scanSegment(state).catch(err => {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.error(`[SCAN] Initial scan failed for segment '${state.segment.name}': ${errMsg}`)
      })
    }

    logger.info('Agent running. Press Ctrl+C to stop.')
    if (config.enableRealtime) {
      logger.info('Realtime mode enabled - segment updates will be pushed instantly')
    }
    if (config.enableAutoScan) {
      logger.info('Auto-scan enabled - will detect local network if no segments assigned')
    }
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...')
    ui.addLog('info', 'Shutting down...')

    // Disconnect realtime client
    if (realtimeClient) {
      try {
        await realtimeClient.disconnect()
      } catch (error) {
        logger.error(`Error disconnecting realtime: ${error}`)
      }
    }

    process.exit(0)
  }

  process.on('SIGINT', () => {
    shutdown().catch(() => process.exit(1))
  })

  process.on('SIGTERM', () => {
    shutdown().catch(() => process.exit(1))
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
