import * as net from 'net'
import type { Logger } from '../utils/logger.js'

export interface TcpResult {
  ip_address: string
  port: number
  status: 'online' | 'offline'
  response_time_ms: number | null
  error?: string
}

/**
 * Check if a TCP port is open on a host
 */
export async function checkTcpPort(
  ip: string,
  port: number,
  logger: Logger,
  timeout = 5000
): Promise<TcpResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      const responseTime = Date.now() - startTime
      cleanup()
      logger.debug(`TCP ${ip}:${port}: open (${responseTime}ms)`)
      resolve({
        ip_address: ip,
        port,
        status: 'online',
        response_time_ms: responseTime,
      })
    })

    socket.on('error', (err) => {
      cleanup()
      const errorMsg = err.message
      logger.debug(`TCP ${ip}:${port}: closed (${errorMsg})`)
      resolve({
        ip_address: ip,
        port,
        status: 'offline',
        response_time_ms: null,
        error: errorMsg,
      })
    })

    socket.on('timeout', () => {
      cleanup()
      logger.debug(`TCP ${ip}:${port}: timeout`)
      resolve({
        ip_address: ip,
        port,
        status: 'offline',
        response_time_ms: null,
        error: 'Connection timeout',
      })
    })

    socket.connect(port, ip)
  })
}

/**
 * Check multiple TCP ports concurrently
 */
export async function checkTcpPorts(
  targets: Array<{ ip: string; port: number }>,
  logger: Logger,
  concurrency = 10
): Promise<TcpResult[]> {
  const results: TcpResult[] = []
  const queue = [...targets]

  logger.debug(`Checking ${targets.length} TCP ports with concurrency ${concurrency}`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const target = queue.shift()
        if (target) {
          const result = await checkTcpPort(target.ip, target.port, logger)
          results.push(result)
        }
      }
    })

  await Promise.all(workers)

  const online = results.filter(r => r.status === 'online').length
  logger.debug(`TCP check complete: ${online}/${results.length} ports open`)

  return results
}
