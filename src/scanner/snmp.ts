import snmp from 'net-snmp'
import type { Logger } from '../utils/logger.js'

export interface SnmpInfo {
  sysName?: string
  sysDescr?: string
  sysContact?: string
  sysLocation?: string
  sysUpTime?: number
}

// Standard SNMP OIDs
const OIDs = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysContact: '1.3.6.1.2.1.1.4.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
}

/**
 * Query SNMP information from a device
 */
export async function querySnmp(
  ip: string,
  logger: Logger,
  community = 'public',
  timeout = 3000
): Promise<SnmpInfo | undefined> {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, community, {
      timeout,
      retries: 1,
      version: snmp.Version2c,
    })

    const oids = Object.values(OIDs)

    session.get(oids, (error, varbinds) => {
      session.close()

      if (error) {
        // SNMP not available or wrong community string
        resolve(undefined)
        return
      }

      const info: SnmpInfo = {}

      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue

        const value = varbind.value?.toString()
        if (!value) continue

        switch (varbind.oid) {
          case OIDs.sysDescr:
            info.sysDescr = value
            break
          case OIDs.sysName:
            info.sysName = value
            break
          case OIDs.sysContact:
            info.sysContact = value
            break
          case OIDs.sysLocation:
            info.sysLocation = value
            break
          case OIDs.sysUpTime:
            info.sysUpTime = parseInt(value, 10)
            break
        }
      }

      if (Object.keys(info).length > 0) {
        logger.debug(`SNMP ${ip}: ${info.sysName || info.sysDescr || 'info found'}`)
        resolve(info)
      } else {
        resolve(undefined)
      }
    })
  })
}

/**
 * Query SNMP on multiple IPs with concurrency limit
 */
export async function querySnmpMultiple(
  ips: string[],
  logger: Logger,
  concurrency = 5
): Promise<Map<string, SnmpInfo>> {
  const results = new Map<string, SnmpInfo>()
  const queue = [...ips]

  logger.debug(`Querying SNMP on ${ips.length} hosts`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const ip = queue.shift()
        if (ip) {
          const info = await querySnmp(ip, logger)
          if (info) {
            results.set(ip, info)
          }
        }
      }
    })

  await Promise.all(workers)

  logger.debug(`SNMP query complete: ${results.size}/${ips.length} responded`)
  return results
}
