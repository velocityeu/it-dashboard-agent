import { config as dotenvConfig } from 'dotenv'

// Load .env file
dotenvConfig()

export interface Config {
  dashboardUrl: string
  apiKey: string
  agentName: string
  heartbeatInterval: number
  statusCheckInterval: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  // Supabase Realtime settings (can be provided via env or heartbeat response)
  supabaseUrl?: string
  supabaseAnonKey?: string
  enableRealtime: boolean
  // Auto-scan settings
  enableAutoScan: boolean
  autoScanInterval: number // seconds between auto-scans
  // Auto-upgrade settings
  enableAutoUpgrade: boolean // Default: false (opt-in)
  autoUpgradeOnMinor: boolean // Default: true (auto-upgrade minor/patch versions)
}

export function loadConfig(): Config {
  const dashboardUrl = process.env.DASHBOARD_URL
  const apiKey = process.env.AGENT_API_KEY

  if (!dashboardUrl) {
    throw new Error('DASHBOARD_URL is required')
  }

  if (!apiKey) {
    throw new Error('AGENT_API_KEY is required')
  }

  return {
    dashboardUrl: dashboardUrl.replace(/\/$/, ''), // Remove trailing slash
    apiKey,
    agentName: process.env.AGENT_NAME || 'IT Dashboard Agent',
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '60', 10) * 1000,
    statusCheckInterval: parseInt(process.env.STATUS_CHECK_INTERVAL || '30', 10) * 1000,
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
    // Supabase Realtime settings (optional - can be provided via heartbeat)
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    enableRealtime: process.env.ENABLE_REALTIME !== 'false', // Default: true
    // Auto-scan settings
    enableAutoScan: process.env.ENABLE_AUTO_SCAN !== 'false', // Default: true
    autoScanInterval: parseInt(process.env.AUTO_SCAN_INTERVAL || '300', 10), // Default: 5 minutes
    // Auto-upgrade settings
    enableAutoUpgrade: process.env.ENABLE_AUTO_UPGRADE === 'true', // Default: false (opt-in)
    autoUpgradeOnMinor: process.env.AUTO_UPGRADE_ON_MINOR !== 'false', // Default: true
  }
}
