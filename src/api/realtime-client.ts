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

    try {
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
            this.handleSegmentChange(payload)
          }
        )
        .subscribe((status: string) => {
          this.logger.debug(`Segment channel status: ${status}`)
          if (status === 'SUBSCRIBED') {
            this.logger.info('Subscribed to segment changes')
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
            this.handleCommand(payload)
          }
        )
        .subscribe((status: string) => {
          this.logger.debug(`Command channel status: ${status}`)
          if (status === 'SUBSCRIBED') {
            this.logger.info('Subscribed to agent commands')
          }
        })

      this.isConnected = true
      this.onConnectionChange?.('connected')
      this.logger.info('Supabase Realtime connected')
    } catch (error) {
      this.logger.error(`Realtime connection failed: ${error}`)
      this.isConnected = false
      this.onConnectionChange?.('error')
      throw error
    }
  }

  /**
   * Disconnect from Supabase Realtime
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Supabase Realtime...')

    if (this.segmentChannel) {
      await this.supabase.removeChannel(this.segmentChannel)
      this.segmentChannel = null
    }

    if (this.commandChannel) {
      await this.supabase.removeChannel(this.commandChannel)
      this.commandChannel = null
    }

    this.isConnected = false
    this.onConnectionChange?.('disconnected')
    this.logger.info('Supabase Realtime disconnected')
  }

  /**
   * Check if connected to Realtime
   */
  get connected(): boolean {
    return this.isConnected
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
        this.logger.error(`Error in segment change callback: ${error}`)
      }
    }
  }

  /**
   * Handle command events from Supabase
   */
  private handleCommand(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): void {
    if (!payload.new) return

    const command = this.mapToCommand(payload.new)
    this.logger.info(`Received command: ${command.command_type} (${command.id})`)

    if (this.onCommand) {
      try {
        this.onCommand(command)
      } catch (error) {
        this.logger.error(`Error in command callback: ${error}`)
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
