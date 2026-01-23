import { Client as SsdpClient } from 'node-ssdp'
import type { Logger } from '../utils/logger.js'

export interface SsdpDevice {
  ip: string
  usn: string
  st: string
  location?: string
  server?: string
  friendlyName?: string
  deviceType?: string
  manufacturer?: string
}

/**
 * Discover UPnP/SSDP devices on the network
 */
export async function discoverSsdpDevices(logger: Logger, timeout = 5000): Promise<SsdpDevice[]> {
  const devices: SsdpDevice[] = []
  const seenUsns = new Set<string>()

  return new Promise((resolve) => {
    const client = new SsdpClient()

    client.on('response', (headers, statusCode, rinfo) => {
      if (statusCode !== 200) return

      const usn = headers.USN as string
      if (!usn || seenUsns.has(usn)) return
      seenUsns.add(usn)

      const device: SsdpDevice = {
        ip: rinfo.address,
        usn,
        st: headers.ST as string || 'unknown',
        location: headers.LOCATION as string,
        server: headers.SERVER as string,
      }

      // Parse device type from ST header
      if (device.st) {
        if (device.st.includes('MediaRenderer')) device.deviceType = 'media-renderer'
        else if (device.st.includes('MediaServer')) device.deviceType = 'media-server'
        else if (device.st.includes('Printer')) device.deviceType = 'printer'
        else if (device.st.includes('IGD') || device.st.includes('InternetGateway')) device.deviceType = 'router'
        else if (device.st.includes('Basic')) device.deviceType = 'basic'
      }

      // Parse manufacturer from Server header
      if (device.server) {
        const match = device.server.match(/^([^\/\s]+)/i)
        if (match) device.manufacturer = match[1]
      }

      logger.debug(`SSDP found: ${device.ip} (${device.deviceType || device.st})`)
      devices.push(device)
    })

    // Search for all UPnP devices
    client.search('ssdp:all')

    // Stop after timeout
    setTimeout(() => {
      client.stop()
      logger.debug(`SSDP discovery complete: ${devices.length} devices`)
      resolve(devices)
    }, timeout)
  })
}

/**
 * Get SSDP devices mapped by IP address
 */
export async function getSsdpDevicesByIp(logger: Logger): Promise<Map<string, SsdpDevice>> {
  const devices = await discoverSsdpDevices(logger)
  const byIp = new Map<string, SsdpDevice>()

  for (const device of devices) {
    // Keep first device per IP (usually the most relevant)
    if (!byIp.has(device.ip)) {
      byIp.set(device.ip, device)
    }
  }

  return byIp
}
