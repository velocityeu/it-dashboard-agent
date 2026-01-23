import * as net from 'net'
import type { Logger } from '../utils/logger.js'

export interface BannerInfo {
  port: number
  banner: string
  service?: string
}

/**
 * Grab banner from a service
 */
export async function grabBanner(
  ip: string,
  port: number,
  logger: Logger,
  timeout = 3000
): Promise<BannerInfo | undefined> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let banner = ''

    const cleanup = () => {
      socket.removeAllListeners()
      socket.destroy()
    }

    socket.setTimeout(timeout)

    socket.on('connect', () => {
      // For some services, we need to send something first
      // Most banner-grabbing services send immediately on connect
    })

    socket.on('data', (data) => {
      banner += data.toString()
      // Got data, can close connection
      cleanup()

      const service = identifyService(port, banner)
      logger.debug(`Banner ${ip}:${port}: ${banner.substring(0, 50).replace(/\r?\n/g, ' ')}`)

      resolve({
        port,
        banner: banner.trim(),
        service,
      })
    })

    socket.on('error', () => {
      cleanup()
      resolve(undefined)
    })

    socket.on('timeout', () => {
      cleanup()
      resolve(undefined)
    })

    socket.on('close', () => {
      if (banner) {
        const service = identifyService(port, banner)
        resolve({ port, banner: banner.trim(), service })
      } else {
        resolve(undefined)
      }
    })

    socket.connect(port, ip)
  })
}

/**
 * Identify service from banner content
 */
function identifyService(port: number, banner: string): string | undefined {
  const lower = banner.toLowerCase()

  // SSH
  if (lower.startsWith('ssh-')) {
    return 'ssh'
  }

  // FTP
  if (lower.includes('ftp') || lower.startsWith('220 ') || lower.startsWith('220-')) {
    return 'ftp'
  }

  // SMTP
  if (lower.includes('smtp') || lower.includes('esmtp') || lower.includes('mail')) {
    return 'smtp'
  }

  // HTTP
  if (lower.startsWith('http/') || lower.includes('<!doctype') || lower.includes('<html')) {
    return 'http'
  }

  // MySQL
  if (banner.charCodeAt(0) === 10 || lower.includes('mysql')) {
    return 'mysql'
  }

  // PostgreSQL
  if (lower.includes('postgresql') || lower.includes('postgres')) {
    return 'postgresql'
  }

  // Use port-based fallback
  const portServices: Record<number, string> = {
    21: 'ftp',
    22: 'ssh',
    23: 'telnet',
    25: 'smtp',
    80: 'http',
    110: 'pop3',
    143: 'imap',
    443: 'https',
    3306: 'mysql',
    5432: 'postgresql',
  }

  return portServices[port]
}

/**
 * Extract OS hints from SSH banner
 */
export function parseSSHBanner(banner: string): string[] {
  const hints: string[] = []

  // SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1
  if (banner.toLowerCase().includes('ubuntu')) {
    hints.push('Linux (Ubuntu)')
  } else if (banner.toLowerCase().includes('debian')) {
    hints.push('Linux (Debian)')
  } else if (banner.toLowerCase().includes('centos') || banner.toLowerCase().includes('rhel')) {
    hints.push('Linux (RHEL/CentOS)')
  } else if (banner.toLowerCase().includes('freebsd')) {
    hints.push('FreeBSD')
  } else if (banner.includes('OpenSSH')) {
    hints.push('Unix/Linux (OpenSSH)')
  }

  // Windows SSH
  if (banner.toLowerCase().includes('windows') || banner.includes('Microsoft')) {
    hints.push('Windows')
  }

  // Dropbear (embedded)
  if (banner.toLowerCase().includes('dropbear')) {
    hints.push('Embedded Linux (Dropbear)')
  }

  // Extract version
  const versionMatch = banner.match(/OpenSSH[_\s]*([\d.]+)/i)
  if (versionMatch) {
    hints.push(`OpenSSH ${versionMatch[1]}`)
  }

  return hints
}

/**
 * Grab banners from common ports on a host
 */
export async function grabBanners(
  ip: string,
  ports: number[],
  logger: Logger
): Promise<BannerInfo[]> {
  const results: BannerInfo[] = []

  // Only try banner grabbing on ports known to send banners
  const bannerPorts = [21, 22, 23, 25, 110, 143, 3306]
  const portsToTry = ports.filter((p) => bannerPorts.includes(p))

  for (const port of portsToTry) {
    const info = await grabBanner(ip, port, logger)
    if (info) {
      results.push(info)
    }
  }

  return results
}
