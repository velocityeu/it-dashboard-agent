import { exec } from 'child_process'
import { promisify } from 'util'
import { createRequire } from 'module'
import { isInCidr, normalizeMac } from '../utils/ip-utils.js'
import type { Logger } from '../utils/logger.js'

// Load OUI database (IEEE MAC address vendor database)
const require = createRequire(import.meta.url)
const ouiData: Record<string, string> = require('oui-data')

const execAsync = promisify(exec)

export interface DiscoveredDevice {
  ip_address: string
  mac_address: string
  hostname?: string
  manufacturer?: string
  os_hints?: string[]
  device_type?: 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown'
  open_ports?: number[]
  services?: string[]
  netbios_name?: string
  discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp'
}

/**
 * Get manufacturer name from MAC address using OUI database
 */
export function getManufacturer(mac: string): string | undefined {
  try {
    // Extract OUI prefix (first 6 hex chars) from MAC address
    const prefix = mac.replace(/[^0-9a-f]/gi, '').toUpperCase().substring(0, 6)
    const result = ouiData[prefix]
    return result || undefined
  } catch {
    return undefined
  }
}

/**
 * Scan ARP table for devices in the specified CIDR range
 */
export async function arpScan(cidr: string, logger: Logger): Promise<DiscoveredDevice[]> {
  const devices: DiscoveredDevice[] = []
  const platform = process.platform

  try {
    let output: string

    if (platform === 'win32') {
      // Windows: arp -a
      const { stdout } = await execAsync('arp -a')
      output = stdout
    } else {
      // Linux/macOS: arp -an
      const { stdout } = await execAsync('arp -an')
      output = stdout
    }

    const lines = output.split('\n')

    for (const line of lines) {
      let ip: string | undefined
      let mac: string | undefined

      if (platform === 'win32') {
        // Windows format: "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-f-]+)/i)
        if (match) {
          ip = match[1]
          mac = match[2]
        }
      } else {
        // Unix format: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff [ether] on en0"
        const match = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\da-f:]+)/i)
        if (match) {
          ip = match[1]
          mac = match[2]
        }
      }

      if (ip && mac && isInCidr(ip, cidr)) {
        // Skip incomplete entries
        if (mac.toLowerCase().includes('incomplete') || mac === '(incomplete)') {
          continue
        }

        const normalizedMac = normalizeMac(mac)
        const manufacturer = getManufacturer(normalizedMac)

        devices.push({
          ip_address: ip,
          mac_address: normalizedMac,
          manufacturer,
          discovery_method: 'arp',
        })
      }
    }

    logger.debug(`ARP scan found ${devices.length} devices in ${cidr}`)
    return devices
  } catch (error) {
    logger.error(`ARP scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return []
  }
}

/**
 * Trigger ARP cache population by pinging the broadcast address or scanning IPs
 * This helps discover more devices before reading the ARP table
 */
export async function populateArpCache(cidr: string, logger: Logger): Promise<void> {
  const platform = process.platform

  try {
    if (platform === 'win32') {
      // Windows: Use ping to broadcast (limited effectiveness)
      // For better results, we'd ping each IP but that's slow
      const [ip] = cidr.split('/')
      const parts = ip.split('.')
      const broadcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`

      logger.debug(`Pinging broadcast address ${broadcast}`)
      await execAsync(`ping -n 1 -w 100 ${broadcast}`, { timeout: 5000 }).catch(() => {})
    } else {
      // Linux/macOS: Similar approach
      const [ip] = cidr.split('/')
      const parts = ip.split('.')
      const broadcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`

      logger.debug(`Pinging broadcast address ${broadcast}`)
      await execAsync(`ping -c 1 -W 1 ${broadcast}`, { timeout: 5000 }).catch(() => {})
    }
  } catch {
    // Broadcast ping often fails, that's okay
    logger.debug('Broadcast ping completed (may have failed, which is normal)')
  }
}
