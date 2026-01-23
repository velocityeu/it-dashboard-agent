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
  }
}
