import { promises as dns } from 'dns'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { Logger } from '../utils/logger.js'

const execAsync = promisify(exec)

/**
 * Resolve hostname for an IP address using DNS reverse lookup
 */
export async function resolveHostname(ip: string, logger: Logger, timeout = 3000): Promise<string | undefined> {
  try {
    // DNS reverse lookup with timeout
    const hostnames = await Promise.race([
      dns.reverse(ip),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), timeout)
      ),
    ])

    if (hostnames && hostnames.length > 0) {
      // Return first hostname, strip trailing dot if present
      const hostname = hostnames[0].replace(/\.$/, '')
      logger.debug(`DNS resolved ${ip} -> ${hostname}`)
      return hostname
    }
    return undefined
  } catch {
    // DNS reverse lookup failed, try NetBIOS on Windows
    if (process.platform === 'win32') {
      return resolveNetBIOS(ip, logger)
    }
    return undefined
  }
}

/**
 * Resolve NetBIOS name on Windows using nbtstat
 */
async function resolveNetBIOS(ip: string, logger: Logger): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`nbtstat -A ${ip}`, { timeout: 5000 })

    // Parse nbtstat output for computer name
    // Format: "COMPUTERNAME     <00>  UNIQUE      Registered"
    const lines = stdout.split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*(\S+)\s+<00>\s+UNIQUE/i)
      if (match) {
        const name = match[1].trim()
        logger.debug(`NetBIOS resolved ${ip} -> ${name}`)
        return name
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve hostnames for multiple IPs concurrently
 */
export async function resolveHostnames(
  ips: string[],
  logger: Logger,
  concurrency = 5
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const queue = [...ips]

  logger.debug(`Resolving hostnames for ${ips.length} IPs`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const ip = queue.shift()
        if (ip) {
          const hostname = await resolveHostname(ip, logger)
          if (hostname) {
            results.set(ip, hostname)
          }
        }
      }
    })

  await Promise.all(workers)

  logger.debug(`Resolved ${results.size}/${ips.length} hostnames`)
  return results
}
