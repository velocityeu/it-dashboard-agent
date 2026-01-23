import { exec } from 'child_process'
import { promisify } from 'util'
import type { Logger } from '../utils/logger.js'

const execAsync = promisify(exec)

export interface PingResult {
  ip_address: string
  status: 'online' | 'offline'
  response_time_ms: number | null
  error?: string
}

/**
 * Ping a single IP address and return the result
 */
export async function pingHost(ip: string, logger: Logger): Promise<PingResult> {
  const platform = process.platform
  const timeout = 5000 // 5 seconds

  try {
    let command: string

    if (platform === 'win32') {
      // Windows: ping -n 1 -w 5000 (count 1, timeout 5000ms)
      command = `ping -n 1 -w 5000 ${ip}`
    } else {
      // Linux/macOS: ping -c 1 -W 5 (count 1, timeout 5 seconds)
      command = `ping -c 1 -W 5 ${ip}`
    }

    const startTime = Date.now()
    const { stdout } = await execAsync(command, { timeout })
    const endTime = Date.now()

    // Parse response time from output
    let responseTime: number | null = null

    if (platform === 'win32') {
      // Windows format: "Reply from x.x.x.x: bytes=32 time=1ms TTL=64"
      // or "time<1ms" for very fast responses
      const timeMatch = stdout.match(/time[=<](\d+)ms/i)
      if (timeMatch) {
        responseTime = parseInt(timeMatch[1], 10)
      }
    } else {
      // Unix format: "64 bytes from x.x.x.x: icmp_seq=1 ttl=64 time=1.23 ms"
      const timeMatch = stdout.match(/time[=]?([\d.]+)\s*ms/i)
      if (timeMatch) {
        responseTime = parseFloat(timeMatch[1])
      }
    }

    // If we couldn't parse, use measured time
    if (responseTime === null) {
      responseTime = endTime - startTime
    }

    // Check for success indicators
    const isSuccess = platform === 'win32'
      ? stdout.includes('Reply from') && !stdout.includes('Destination host unreachable')
      : stdout.includes('bytes from') || stdout.includes('1 received')

    if (isSuccess) {
      logger.debug(`Ping ${ip}: online (${responseTime}ms)`)
      return {
        ip_address: ip,
        status: 'online',
        response_time_ms: Math.round(responseTime),
      }
    } else {
      logger.debug(`Ping ${ip}: offline (no reply)`)
      return {
        ip_address: ip,
        status: 'offline',
        response_time_ms: null,
      }
    }
  } catch (error) {
    // Ping command failed (timeout or error)
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.debug(`Ping ${ip}: offline (${errorMsg})`)
    return {
      ip_address: ip,
      status: 'offline',
      response_time_ms: null,
      error: errorMsg,
    }
  }
}

/**
 * Ping multiple hosts concurrently with a concurrency limit
 */
export async function pingHosts(
  ips: string[],
  logger: Logger,
  concurrency = 10
): Promise<PingResult[]> {
  const results: PingResult[] = []
  const queue = [...ips]

  logger.debug(`Pinging ${ips.length} hosts with concurrency ${concurrency}`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const ip = queue.shift()
        if (ip) {
          const result = await pingHost(ip, logger)
          results.push(result)
        }
      }
    })

  await Promise.all(workers)

  const online = results.filter(r => r.status === 'online').length
  logger.debug(`Ping complete: ${online}/${results.length} hosts online`)

  return results
}
