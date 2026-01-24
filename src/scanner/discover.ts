import { isLocalNetwork } from '../utils/ip-utils.js'
import { arpScan, populateArpCache, type DiscoveredDevice } from './arp.js'
import { pingSweep } from './ping-sweep.js'
import type { Logger } from '../utils/logger.js'

export type { DiscoveredDevice }

/**
 * Unified device discovery function that selects the appropriate method
 * based on whether the target network is local or remote.
 *
 * For local networks (directly connected):
 * - Uses ARP scanning (fast, provides MAC address and manufacturer info)
 *
 * For remote networks (across routers):
 * - Uses ICMP ping sweep (slower, no MAC/manufacturer info, requires ICMP allowed)
 *
 * @param cidr - The CIDR range to scan (e.g., "192.168.1.0/24")
 * @param logger - Logger instance for output
 * @param pingConcurrency - Concurrency for ping sweep (default 50)
 * @returns Array of discovered devices
 */
export async function discoverDevices(
  cidr: string,
  logger: Logger,
  pingConcurrency = 50
): Promise<DiscoveredDevice[]> {
  const isLocal = isLocalNetwork(cidr)

  if (isLocal) {
    logger.info(`Segment ${cidr} is LOCAL - using ARP discovery`)

    // Populate ARP cache first
    await populateArpCache(cidr, logger)

    // Small delay for ARP cache to populate
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Scan ARP table
    return arpScan(cidr, logger)
  } else {
    logger.info(`Segment ${cidr} is REMOTE - using ping sweep`)
    logger.info(`Note: MAC address and manufacturer info not available for remote networks`)

    return pingSweep(cidr, logger, pingConcurrency)
  }
}
