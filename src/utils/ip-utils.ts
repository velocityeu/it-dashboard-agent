import os from 'os'

/**
 * Parse CIDR notation to get list of IP addresses
 */
export function parseCidr(cidr: string): string[] {
  const [ip, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)

  if (prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR prefix: ${prefix}`)
  }

  const parts = ip.split('.').map(p => parseInt(p, 10))
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IP address: ${ip}`)
  }

  const ipNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
  const mask = ~((1 << (32 - prefix)) - 1)
  const networkAddr = ipNum & mask
  const broadcastAddr = networkAddr | ~mask

  const ips: string[] = []

  // Skip network address and broadcast address for /24 and smaller
  const start = prefix >= 31 ? networkAddr : networkAddr + 1
  const end = prefix >= 31 ? broadcastAddr : broadcastAddr - 1

  for (let i = start; i <= end; i++) {
    ips.push(numToIp(i >>> 0)) // >>> 0 to handle as unsigned
  }

  return ips
}

/**
 * Convert number to IP address string
 */
function numToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.')
}

/**
 * Convert IP address string to number
 */
export function ipToNum(ip: string): number {
  const parts = ip.split('.').map(p => parseInt(p, 10))
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

/**
 * Check if an IP is within a CIDR range
 */
export function isInCidr(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)

  const ipNum = ipToNum(ip)
  const cidrNum = ipToNum(cidrIp)
  const mask = ~((1 << (32 - prefix)) - 1)

  return (ipNum & mask) === (cidrNum & mask)
}

/**
 * Normalize MAC address to AA:BB:CC:DD:EE:FF format
 */
export function normalizeMac(mac: string): string {
  // Remove all separators and convert to uppercase
  const cleaned = mac.replace(/[:-]/g, '').toUpperCase()
  if (cleaned.length !== 12) {
    return mac // Return original if invalid
  }
  // Format as AA:BB:CC:DD:EE:FF
  return cleaned.match(/.{2}/g)?.join(':') || mac
}

/**
 * Check if a CIDR range overlaps with any local network interface.
 * Used to determine whether to use ARP (local) or ping sweep (remote) for discovery.
 */
export function isLocalNetwork(cidr: string): boolean {
  const interfaces = os.networkInterfaces()

  const [targetIp, targetPrefixStr] = cidr.split('/')
  const targetPrefix = parseInt(targetPrefixStr, 10)
  const targetNum = ipToNum(targetIp)
  const targetMask = ~((1 << (32 - targetPrefix)) - 1) >>> 0

  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name]
    if (!addrs) continue

    for (const addr of addrs) {
      // Only check IPv4 addresses
      if (addr.family !== 'IPv4') continue

      const localIp = addr.address
      const localNetmask = addr.netmask

      // Calculate local network from IP and netmask
      const localNum = ipToNum(localIp)
      const localMaskNum = ipToNum(localNetmask)
      const localNetwork = (localNum & localMaskNum) >>> 0

      // Calculate target network
      const targetNetwork = (targetNum & targetMask) >>> 0

      // Check if the networks overlap
      // They overlap if either network contains the other
      const targetInLocal = (targetNum & localMaskNum) === localNetwork
      const localInTarget = (localNum & targetMask) === targetNetwork

      if (targetInLocal || localInTarget) {
        return true
      }
    }
  }

  return false
}

/**
 * Expand a CIDR to all usable IP addresses
 */
export function expandCidr(cidr: string): string[] {
  return parseCidr(cidr)
}
