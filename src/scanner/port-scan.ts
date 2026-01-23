import * as net from 'net'
import type { Logger } from '../utils/logger.js'

// Top 20 common ports to scan
export const COMMON_PORTS = [
  { port: 22, service: 'ssh' },
  { port: 23, service: 'telnet' },
  { port: 25, service: 'smtp' },
  { port: 53, service: 'dns' },
  { port: 80, service: 'http' },
  { port: 110, service: 'pop3' },
  { port: 135, service: 'rpc' },
  { port: 139, service: 'netbios' },
  { port: 143, service: 'imap' },
  { port: 443, service: 'https' },
  { port: 445, service: 'smb' },
  { port: 993, service: 'imaps' },
  { port: 995, service: 'pop3s' },
  { port: 1433, service: 'mssql' },
  { port: 3306, service: 'mysql' },
  { port: 3389, service: 'rdp' },
  { port: 5432, service: 'postgresql' },
  { port: 5900, service: 'vnc' },
  { port: 8080, service: 'http-alt' },
  { port: 8443, service: 'https-alt' },
]

export interface PortScanResult {
  ip: string
  openPorts: number[]
  services: string[]
}

/**
 * Check if a single port is open
 */
async function checkPort(ip: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      cleanup()
      resolve(true)
    })

    socket.on('error', () => {
      cleanup()
      resolve(false)
    })

    socket.on('timeout', () => {
      cleanup()
      resolve(false)
    })

    socket.connect(port, ip)
  })
}

/**
 * Scan common ports on a single IP
 */
export async function scanPorts(ip: string, logger: Logger): Promise<PortScanResult> {
  const openPorts: number[] = []
  const services: string[] = []

  // Scan all ports concurrently for speed
  const results = await Promise.all(
    COMMON_PORTS.map(async ({ port, service }) => {
      const isOpen = await checkPort(ip, port)
      return { port, service, isOpen }
    })
  )

  for (const { port, service, isOpen } of results) {
    if (isOpen) {
      openPorts.push(port)
      services.push(service)
    }
  }

  if (openPorts.length > 0) {
    logger.debug(`Port scan ${ip}: ${openPorts.length} open ports (${services.join(', ')})`)
  }

  return { ip, openPorts, services }
}

/**
 * Scan ports on multiple IPs with concurrency limit
 */
export async function scanPortsMultiple(
  ips: string[],
  logger: Logger,
  concurrency = 5
): Promise<Map<string, PortScanResult>> {
  const results = new Map<string, PortScanResult>()
  const queue = [...ips]

  logger.debug(`Scanning ports on ${ips.length} hosts (concurrency: ${concurrency})`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const ip = queue.shift()
        if (ip) {
          const result = await scanPorts(ip, logger)
          results.set(ip, result)
        }
      }
    })

  await Promise.all(workers)

  const totalOpen = Array.from(results.values()).reduce((sum, r) => sum + r.openPorts.length, 0)
  logger.debug(`Port scan complete: ${totalOpen} open ports across ${results.size} hosts`)

  return results
}
