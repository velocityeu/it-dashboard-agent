import axios, { AxiosInstance } from 'axios'
import type { Logger } from '../utils/logger.js'

export interface NetworkSegment {
  id: string
  name: string
  cidr: string
  scan_interval_seconds: number
  is_auto_registered?: boolean
  interface_name?: string
}

export interface HeartbeatResponse {
  success: boolean
  agent_id: string
  agent_name: string
  server_time: string
  segments: NetworkSegment[]
  // Supabase credentials for realtime subscription
  supabase_url?: string
  supabase_anon_key?: string
  // Version management
  latest_agent_version?: string
  agent_download_url?: string
  upgrade_available?: boolean
  // Pending commands (fallback when realtime is down)
  pending_commands?: AgentCommand[]
}

export interface AutoSegmentRequest {
  cidr: string
  name: string
  interface_name: string
}

export interface AgentCommand {
  id: string
  command_type: 'scan_now' | 'scan_segment' | 'update_config' | 'restart' | 'upgrade' | 'ping'
  payload?: Record<string, unknown>
  status: 'pending' | 'completed' | 'failed'
  created_at: string
  executed_at?: string
}

export interface DiscoveredDevice {
  ip_address: string
  mac_address?: string
  hostname?: string
  manufacturer?: string
  os_hints?: string[]
  device_type?: 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown'
  open_ports?: number[]
  services?: string[]
  netbios_name?: string
  snmp_info?: {
    sysName?: string
    sysDescr?: string
    sysContact?: string
    sysLocation?: string
  }
  upnp_info?: {
    friendlyName?: string
    deviceType?: string
    manufacturer?: string
  }
  discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp'
}

export interface DiscoveryResponse {
  success: boolean
  created: number
  updated: number
  unchanged: number
}

export interface DeviceToMonitor {
  id: string
  ip_address?: string
  check_type: 'ping' | 'http' | 'tcp'
  port?: number | null
  url?: string
  is_monitored: boolean
}

export interface StatusReport {
  device_id?: string
  ip_address: string
  status: 'online' | 'offline' | 'degraded' | 'unknown'
  response_time_ms: number | null
  check_type: 'ping' | 'http' | 'tcp'
  checked_at: string
  error?: string
}

export interface StatusResponse {
  success: boolean
  processed: number
  errors: string[]
}

export class DashboardClient {
  private client: AxiosInstance
  private logger: Logger

  constructor(dashboardUrl: string, apiKey: string, logger: Logger) {
    this.logger = logger
    this.client = axios.create({
      baseURL: dashboardUrl,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
  }

  /**
   * Send heartbeat to dashboard and get assigned segments
   */
  async heartbeat(version: string, hostname: string): Promise<HeartbeatResponse> {
    this.logger.debug('Sending heartbeat to dashboard')
    const response = await this.client.post<HeartbeatResponse>('/api/agent/heartbeat', {
      version,
      hostname,
      uptime_seconds: Math.floor(process.uptime()),
    })
    this.logger.debug(`Heartbeat response: ${response.data.segments.length} segments`)
    return response.data
  }

  /**
   * Upload discovered devices from network scan
   */
  async uploadDiscoveredDevices(
    segmentId: string,
    devices: DiscoveredDevice[]
  ): Promise<DiscoveryResponse> {
    this.logger.debug(`Uploading ${devices.length} discovered devices for segment ${segmentId}`)
    const response = await this.client.post<DiscoveryResponse>('/api/agent/devices/discovered', {
      segment_id: segmentId,
      scan_timestamp: new Date().toISOString(),
      devices,
    })
    return response.data
  }

  /**
   * Get list of devices to monitor
   */
  async getDevicesToMonitor(): Promise<DeviceToMonitor[]> {
    this.logger.debug('Fetching devices to monitor')
    const response = await this.client.get<{ devices: DeviceToMonitor[] }>('/api/agent/devices')
    return response.data.devices
  }

  /**
   * Upload device status reports
   */
  async uploadStatusReports(reports: StatusReport[]): Promise<StatusResponse> {
    this.logger.debug(`Uploading ${reports.length} status reports`)
    const response = await this.client.post<StatusResponse>('/api/agent/devices/status', {
      reports,
    })
    return response.data
  }

  /**
   * Register an auto-detected network segment with the dashboard
   * Used when agent starts with no segments assigned
   */
  async registerAutoSegment(request: AutoSegmentRequest): Promise<NetworkSegment> {
    this.logger.info(`Registering auto-detected segment: ${request.name} (${request.cidr})`)
    const response = await this.client.post<{ success: boolean; segment: NetworkSegment }>(
      '/api/agent/segments/register',
      request
    )
    return response.data.segment
  }

  /**
   * Acknowledge command execution to the dashboard
   */
  async acknowledgeCommand(
    commandId: string,
    status: 'completed' | 'failed',
    error?: string
  ): Promise<void> {
    this.logger.debug(`Acknowledging command ${commandId}: ${status}`)
    await this.client.post(`/api/agent/commands/${commandId}/ack`, {
      status,
      executed_at: new Date().toISOString(),
      error,
    })
  }

  /**
   * Send a ping from agent to dashboard
   */
  async pingDashboard(): Promise<void> {
    this.logger.debug('Sending ping to dashboard')
    await this.client.post('/api/agent/ping', {
      timestamp: new Date().toISOString(),
    })
  }
}
