import type { Logger } from '../utils/logger.js'
import type { SnmpInfo } from './snmp.js'
import type { BannerInfo } from './banner.js'
import { parseSSHBanner } from './banner.js'

export type DeviceType = 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown'

export interface OsDetectionResult {
  osHints: string[]
  deviceType: DeviceType
}

/**
 * Detect OS and device type from collected information
 */
export function detectOS(
  openPorts: number[],
  services: string[],
  banners: BannerInfo[],
  snmpInfo?: SnmpInfo,
  ttl?: number,
  manufacturer?: string,
  logger?: Logger
): OsDetectionResult {
  const osHints: string[] = []
  let deviceType: DeviceType = 'unknown'

  // 1. TTL-based detection
  if (ttl !== undefined) {
    if (ttl <= 64) {
      osHints.push('Linux/Unix (TTL ~64)')
    } else if (ttl <= 128) {
      osHints.push('Windows (TTL ~128)')
    } else if (ttl <= 255) {
      osHints.push('Network device (TTL ~255)')
    }
  }

  // 2. Port-based detection
  if (openPorts.includes(3389)) {
    osHints.push('Windows (RDP open)')
    deviceType = 'workstation'
  }
  if (openPorts.includes(22) && !openPorts.includes(3389)) {
    osHints.push('Unix/Linux (SSH open)')
  }
  if (openPorts.includes(445) || openPorts.includes(139)) {
    osHints.push('Windows (SMB open)')
  }
  if (openPorts.includes(548)) {
    osHints.push('macOS (AFP open)')
    deviceType = 'workstation'
  }

  // 3. Banner-based detection
  for (const banner of banners) {
    if (banner.port === 22) {
      const sshHints = parseSSHBanner(banner.banner)
      osHints.push(...sshHints)
    }
    if (banner.banner.includes('IIS')) {
      osHints.push('Windows (IIS)')
      deviceType = 'server'
    }
    if (banner.banner.includes('nginx')) {
      osHints.push('nginx web server')
    }
    if (banner.banner.includes('Apache')) {
      osHints.push('Apache web server')
    }
  }

  // 4. SNMP-based detection
  if (snmpInfo?.sysDescr) {
    const desc = snmpInfo.sysDescr.toLowerCase()
    if (desc.includes('windows')) {
      osHints.push(`Windows (${snmpInfo.sysDescr.substring(0, 50)})`)
      deviceType = deviceType === 'unknown' ? 'workstation' : deviceType
    }
    if (desc.includes('linux')) {
      osHints.push(`Linux (${snmpInfo.sysDescr.substring(0, 50)})`)
    }
    if (desc.includes('cisco')) {
      osHints.push('Cisco IOS')
      deviceType = 'network'
    }
    if (desc.includes('juniper')) {
      osHints.push('Juniper')
      deviceType = 'network'
    }
    if (desc.includes('hp ') || desc.includes('hewlett')) {
      if (desc.includes('switch') || desc.includes('procurve')) {
        deviceType = 'network'
      } else if (desc.includes('printer') || desc.includes('laserjet') || desc.includes('officejet')) {
        deviceType = 'printer'
      }
    }
  }

  // 5. Manufacturer-based device type hints
  if (manufacturer) {
    const mfg = manufacturer.toLowerCase()

    // Network equipment manufacturers
    if (['cisco', 'juniper', 'arista', 'ubiquiti', 'netgear', 'tp-link', 'mikrotik', 'fortinet'].some(v => mfg.includes(v))) {
      if (deviceType === 'unknown') deviceType = 'network'
    }

    // Printer manufacturers
    if (['hp inc', 'hewlett', 'canon', 'epson', 'brother', 'xerox', 'lexmark', 'ricoh', 'konica'].some(v => mfg.includes(v))) {
      if (deviceType === 'unknown') deviceType = 'printer'
    }

    // IoT / Smart device manufacturers
    if (['amazon', 'google', 'nest', 'philips', 'sonos', 'ring', 'wyze', 'ecobee', 'espressif', 'tuya'].some(v => mfg.includes(v))) {
      deviceType = 'iot'
    }

    // Computer manufacturers
    if (['dell', 'lenovo', 'apple', 'microsoft', 'asus', 'acer', 'intel', 'vmware', 'virtual'].some(v => mfg.includes(v))) {
      if (deviceType === 'unknown') deviceType = 'workstation'
    }
  }

  // 6. Service-based device type inference
  if (deviceType === 'unknown') {
    // Servers typically have web/database/mail services
    if (services.includes('http') || services.includes('https') || services.includes('mysql') || services.includes('postgresql') || services.includes('smtp')) {
      if (openPorts.length >= 3) {
        deviceType = 'server'
      }
    }
  }

  // Remove duplicate hints
  const uniqueHints = [...new Set(osHints)]

  logger?.debug(`OS detection: ${uniqueHints.join(', ')} | Type: ${deviceType}`)

  return {
    osHints: uniqueHints,
    deviceType,
  }
}
