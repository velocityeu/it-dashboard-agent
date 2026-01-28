import { createClient, SupabaseClient, RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Logger } from '../utils/logger.js'
import type { NetworkSegment, AgentCommand } from './client.js'

export interface RealtimeConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  agentId: string
}

export interface SegmentChangePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  old?: NetworkSegment
  new?: NetworkSegment
}

export interface CommandPayload {
  eventType: 'INSERT' | 'UPDATE'
  old?: AgentCommand
  new?: AgentCommand
}

export type SegmentChangeCallback = (payload: SegmentChangePayload) => void
export type CommandCallback = (command: AgentCommand) => void
export type ConnectionCallback = (status: 'connected' | 'disconnected' | 'error') => void

/**
 * Supabase Realtime client for receiving push updates from the dashboard
 * Provides near-instant updates for segment changes and commands
 */
export class RealtimeClient {
  private supabase: SupabaseClient
  private logger: Logger
  private agentId: string
  private segmentChannel: RealtimeChannel | null = null
  private commandChannel: RealtimeChannel | null = null
  private isConnected = false

  // Subscription tracking - only report connected when channels are actually subscribed
  private segmentChannelSubscribed = false
  private commandChannelSubscribed = false

  // Health monitoring
  private lastMessageReceived = 0
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private static readonly MAX_RECONNECT_ATTEMPTS = 10
  private static readonly INITIAL_RECONNECT_DELAY = 1000 // 1 second
  private static readonly MAX_RECONNECT_DELAY = 30000 // 30 seconds
  private static readonly HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
  private static readonly STALE_THRESHOLD = 600000 // 10 minutes without message (increased to reduce reconnects during quiet periods)

  // Callbacks
  private onSegmentChange: SegmentChangeCallback | null = null
  private onCommand: CommandCallback | null = null
  private onConnectionChange: ConnectionCallback | null = null

  constructor(config: RealtimeConfig, logger: Logger) {
    this.logger = logger
    this.agentId = config.agentId

    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10, // Rate limit to prevent flooding
        },
      },
    })

    this.logger.info('Supabase Realtime client initialized')
  }

  /**
   * Set callback for segment changes (INSERT/UPDATE/DELETE)
   */
  onSegmentChanges(callback: SegmentChangeCallback): void {
    this.onSegmentChange = callback
  }

  /**
   * Set callback for incoming commands
   */
  onCommands(callback: CommandCallback): void {
    this.onCommand = callback
  }

  /**
   * Set callback for connection status changes
   */
  onConnection(callback: ConnectionCallback): void {
    this.onConnectionChange = callback
  }

  /**
   * Connect to Supabase Realtime and subscribe to relevant channels
   */
  async connect(): Promise<void> {
    this.logger.info('Connecting to Supabase Realtime...')

    // Clear any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    try {
      // Reset subscription state
      this.segmentChannelSubscribed = false
      this.commandChannelSubscribed = false
      this.lastMessageReceived = Date.now()

      // Subscribe to segment changes for this agent
      this.segmentChannel = this.supabase
        .channel(`agent:${this.agentId}:segments`)
        .on(
          'postgres_changes',
          {
            event: '*', // Listen to INSERT, UPDATE, DELETE
            schema: 'public',
            table: 'network_segments',
            filter: `agent_id=eq.${this.agentId}`,
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            this.lastMessageReceived = Date.now()
            this.handleSegmentChange(payload)
          }
        )
        .subscribe((status: string) => {
          this.logger.debug(`Segment channel status: ${status}`)
          if (status === 'SUBSCRIBED') {
            this.logger.info('Subscribed to segment changes')
            this.segmentChannelSubscribed = true
            this.checkFullyConnected()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error(`Segment channel error: ${status}`)
            this.segmentChannelSubscribed = false
            this.handleConnectionError()
          } else if (status === 'CLOSED') {
            this.segmentChannelSubscribed = false
            this.updateConnectionState()
          }
        })

      // Subscribe to commands for this agent
      this.commandChannel = this.supabase
        .channel(`agent:${this.agentId}:commands`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT', // Only listen to new commands
            schema: 'public',
            table: 'agent_commands',
            filter: `agent_id=eq.${this.agentId}`,
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            this.lastMessageReceived = Date.now()
            this.handleCommand(payload)
          }
        )
        .subscribe((status: string) => {
          this.logger.debug(`Command channel status: ${status}`)
          if (status === 'SUBSCRIBED') {
            this.logger.info('Subscribed to agent commands')
            this.commandChannelSubscribed = true
            this.checkFullyConnected()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error(`Command channel error: ${status}`)
            this.commandChannelSubscribed = false
            this.handleConnectionError()
          } else if (status === 'CLOSED') {
            this.commandChannelSubscribed = false
            this.updateConnectionState()
          }
        })

      // Mark as connected (will be refined when subscriptions confirm)
      this.isConnected = true

      // Start health check
      this.startHealthCheck()

    } catch (error) {
      this.logger.error(`Realtime connection failed: ${error}`)
      this.isConnected = false
      this.segmentChannelSubscribed = false
      this.commandChannelSubscribed = false
      this.onConnectionChange?.('error')
      this.scheduleReconnect()
      throw error
    }
  }

  /**
   * Check if both channels are subscribed and update connection state
   */
  private checkFullyConnected(): void {
    if (this.segmentChannelSubscribed && this.commandChannelSubscribed) {
      this.isConnected = true
      this.reconnectAttempts = 0 // Reset on successful full connection
      this.onConnectionChange?.('connected')
      this.logger.info('Supabase Realtime fully connected')
    }
  }

  /**
   * Update connection state based on subscription status
   */
  private updateConnectionState(): void {
    const wasConnected = this.isConnected
    this.isConnected = this.segmentChannelSubscribed && this.commandChannelSubscribed

    if (wasConnected && !this.isConnected) {
      this.onConnectionChange?.('disconnected')
    }
  }

  /**
   * Handle connection errors with retry logic
   */
  private handleConnectionError(): void {
    this.isConnected = false
    this.onConnectionChange?.('error')
    this.scheduleReconnect()
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return // Already scheduled
    }

    if (this.reconnectAttempts >= RealtimeClient.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`Max reconnection attempts (${RealtimeClient.MAX_RECONNECT_ATTEMPTS}) reached, waiting for next heartbeat`)
      this.reconnectAttempts = 0
      return
    }

    const delay = Math.min(
      RealtimeClient.INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      RealtimeClient.MAX_RECONNECT_DELAY
    )
    this.reconnectAttempts++

    this.logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.disconnect()
        await this.connect()
      } catch (error) {
        this.logger.error(`Reconnect attempt ${this.reconnectAttempts} failed: ${error}`)
        // Will schedule another attempt via handleConnectionError
      }
    }, delay)
  }

  /**
   * Start periodic health check to detect stale connections
   */
  private startHealthCheck(): void {
    this.stopHealthCheck()

    this.healthCheckTimer = setInterval(() => {
      if (!this.isConnected) return

      const timeSinceLastMessage = Date.now() - this.lastMessageReceived

      // Note: In quiet periods, no messages is normal. But if we haven't received
      // anything in STALE_THRESHOLD ms and we think we're connected, verify.
      if (timeSinceLastMessage > RealtimeClient.STALE_THRESHOLD) {
        this.logger.warn(`Connection may be stale (${Math.round(timeSinceLastMessage / 1000)}s without message)`)
        // Force reconnect
        this.handleConnectionError()
      }
    }, RealtimeClient.HEALTH_CHECK_INTERVAL)
  }

  /**
   * Stop health check timer
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /**
   * Disconnect from Supabase Realtime
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Supabase Realtime...')

    // Stop health check and pending reconnects
    this.stopHealthCheck()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.segmentChannel) {
      await this.supabase.removeChannel(this.segmentChannel)
      this.segmentChannel = null
    }

    if (this.commandChannel) {
      await this.supabase.removeChannel(this.commandChannel)
      this.commandChannel = null
    }

    this.isConnected = false
    this.segmentChannelSubscribed = false
    this.commandChannelSubscribed = false
    this.onConnectionChange?.('disconnected')
    this.logger.info('Supabase Realtime disconnected')
  }

  /**
   * Check if connected to Realtime (both channels subscribed)
   */
  get connected(): boolean {
    return this.isConnected && this.segmentChannelSubscribed && this.commandChannelSubscribed
  }

  /**
   * Check if the connection is healthy (connected and not stale)
   */
  isHealthy(): boolean {
    if (!this.connected) return false
    const timeSinceLastMessage = Date.now() - this.lastMessageReceived
    return timeSinceLastMessage < RealtimeClient.STALE_THRESHOLD
  }

  /**
   * Handle segment change events from Supabase
   */
  private handleSegmentChange(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
    this.logger.debug(`Segment change: ${payload.eventType}`)

    const changePayload: SegmentChangePayload = {
      eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
      old: payload.old ? this.mapToSegment(payload.old) : undefined,
      new: payload.new ? this.mapToSegment(payload.new) : undefined,
    }

    if (this.onSegmentChange) {
      try {
        this.onSegmentChange(changePayload)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.logger.error(`[REALTIME] Error in segment change callback: ${errMsg}`)
      }
    }
  }

  /**
   * Handle command events from Supabase
   */
  private handleCommand(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
    if (!payload.new) return

    const command = this.mapToCommand(payload.new)
    this.logger.info(`[REALTIME] Command received: '${command.command_type}' (id: ${command.id})`)

    if (this.onCommand) {
      try {
        this.onCommand(command)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.logger.error(`[REALTIME] Error in command callback: ${errMsg}`)
      }
    }
  }

  /**
   * Map database record to NetworkSegment
   */
  private mapToSegment(record: Record<string, unknown>): NetworkSegment {
    return {
      id: record.id as string,
      name: record.name as string,
      cidr: record.cidr as string,
      scan_interval_seconds: record.scan_interval_seconds as number,
      is_auto_registered: record.is_auto_registered as boolean | undefined,
      interface_name: record.interface_name as string | undefined,
    }
  }

  /**
   * Map database record to AgentCommand
   */
  private mapToCommand(record: Record<string, unknown>): AgentCommand {
    return {
      id: record.id as string,
      command_type: record.command_type as AgentCommand['command_type'],
      payload: record.payload as Record<string, unknown> | undefined,
      status: record.status as AgentCommand['status'],
      created_at: record.created_at as string,
      executed_at: record.executed_at as string | undefined,
    }
  }

  /**
   * Update the agent ID (e.g., after first heartbeat)
   * Reconnects to channels with new agent ID
   */
  async updateAgentId(newAgentId: string): Promise<void> {
    if (this.agentId === newAgentId) return

    this.logger.info(`Updating agent ID: ${this.agentId} -> ${newAgentId}`)
    this.agentId = newAgentId

    // Reconnect with new agent ID
    if (this.isConnected) {
      await this.disconnect()
      await this.connect()
    }
  }
}
