import os from 'os'

export interface LocalNetwork {
  interfaceName: string
  address: string
  netmask: string
  cidr: string
  mac: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
}

/**
 * Calculate CIDR notation from IP address and netmask
 */
function calculateCidr(address: string, netmask: string): string {
  // Count the number of 1-bits in the netmask
  const maskParts = netmask.split('.').map(Number)
  let cidrBits = 0

  for (const part of maskParts) {
    // Count bits for each octet
    let n = part
    while (n > 0) {
      cidrBits += n & 1
      n >>= 1
    }
  }

  // Calculate network address
  const ipParts = address.split('.').map(Number)
  const networkParts = ipParts.map((ip, i) => ip & maskParts[i])
  const networkAddress = networkParts.join('.')

  return `${networkAddress}/${cidrBits}`
}

/**
 * Detect all local network interfaces with IPv4 addresses
 */
export function detectLocalNetworks(): LocalNetwork[] {
  const interfaces = os.networkInterfaces()
  const networks: LocalNetwork[] = []

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue

    for (const addr of addrs) {
      // Only include IPv4, non-internal interfaces
      if (addr.family === 'IPv4' && !addr.internal) {
        const cidr = calculateCidr(addr.address, addr.netmask)

        networks.push({
          interfaceName: name,
          address: addr.address,
          netmask: addr.netmask,
          cidr,
          mac: addr.mac,
          family: 'IPv4',
          internal: addr.internal,
        })
      }
    }
  }

  return networks
}

/**
 * Get the primary local network (first non-internal IPv4 interface)
 * Prefers interfaces that look like the main network connection:
 * - Ethernet/WiFi over VPN/Docker/Virtual adapters
 * - Non-link-local addresses (169.254.x.x)
 */
export function getPrimaryLocalNetwork(): LocalNetwork | null {
  const networks = detectLocalNetworks()

  if (networks.length === 0) {
    return null
  }

  // Filter out link-local addresses (169.254.x.x)
  const nonLinkLocal = networks.filter(n => !n.address.startsWith('169.254.'))

  if (nonLinkLocal.length === 0) {
    return networks[0] // Fallback to first available
  }

  // Prefer common physical interface names
  const preferredPrefixes = [
    'eth',      // Linux ethernet
    'en',       // macOS ethernet/WiFi
    'wlan',     // Linux WiFi
    'wi-fi',    // Windows WiFi
    'ethernet', // Windows ethernet
  ]

  for (const prefix of preferredPrefixes) {
    const match = nonLinkLocal.find(n =>
      n.interfaceName.toLowerCase().startsWith(prefix)
    )
    if (match) return match
  }

  // Avoid virtual/VPN interfaces
  const virtualPrefixes = ['docker', 'veth', 'br-', 'virbr', 'vmnet', 'vbox', 'tun', 'tap']
  const physicalNetworks = nonLinkLocal.filter(n =>
    !virtualPrefixes.some(vp => n.interfaceName.toLowerCase().includes(vp))
  )

  return physicalNetworks[0] || nonLinkLocal[0]
}

/**
 * Generate a human-readable name for an auto-detected segment
 */
export function generateAutoSegmentName(network: LocalNetwork): string {
  return `Auto: ${network.interfaceName} (${network.cidr})`
}
