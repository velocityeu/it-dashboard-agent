import axios, { AxiosInstance } from 'axios'
import type { Logger } from '../utils/logger.js'

export interface NetworkSegment {
  id: string
  name: string
  cidr: string
  scan_interval_seconds: number
}

export interface HeartbeatResponse {
  success: boolean
  agent_id: string
  agent_name: string
  server_time: string
  segments: NetworkSegment[]
}

export interface DiscoveredDevice {
  ip_address: string
  mac_address?: string
  hostname?: string
  discovery_method: 'arp' | 'ping_sweep'
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
}
