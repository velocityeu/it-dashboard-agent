import { expandCidr } from '../utils/ip-utils.js'
import { pingHost, type PingResult } from './ping.js'
import type { Logger } from '../utils/logger.js'
import type { DiscoveredDevice } from './arp.js'

/**
 * Discover devices on a remote network segment using ICMP ping sweep.
 *
 * This is used when the target network is not directly connected to the agent.
 * ARP only works for local segments, but ping sweep can reach remote networks
 * as long as ICMP is allowed through firewalls.
 *
 * Limitations:
 * - No MAC address discovery (Layer 2 info not available across routers)
 * - No manufacturer detection (requires MAC address)
 * - Slower than ARP (must ping each IP individually)
 * - Some devices may not respond to ICMP even if online
 */
export async function pingSweep(
  cidr: string,
  logger: Logger,
  concurrency = 50
): Promise<DiscoveredDevice[]> {
  const ips = expandCidr(cidr)
  const discovered: DiscoveredDevice[] = []

  logger.info(`Ping sweep starting for ${cidr} (${ips.length} IPs, concurrency: ${concurrency})`)

  // Process IPs in batches with concurrency limit
  const queue = [...ips]
  const results: PingResult[] = []

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const ip = queue.shift()
        if (ip) {
          const result = await pingHost(ip, logger)
          results.push(result)

          // Log progress every 50 IPs
          if (results.length % 50 === 0) {
            logger.debug(`Ping sweep progress: ${results.length}/${ips.length}`)
          }
        }
      }
    })

  await Promise.all(workers)

  // Convert successful pings to discovered devices
  for (const result of results) {
    if (result.status === 'online') {
      discovered.push({
        ip_address: result.ip_address,
        mac_address: '', // Not available for remote networks
        manufacturer: undefined, // Requires MAC address
        discovery_method: 'arp', // Use 'arp' for compatibility (ping is a type of discovery)
      })
    }
  }

  const online = discovered.length
  const total = ips.length
  logger.info(`Ping sweep complete: ${online}/${total} hosts responded`)

  return discovered
}
