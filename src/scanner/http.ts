import axios from 'axios'
import type { Logger } from '../utils/logger.js'

export interface HttpResult {
  url: string
  status: 'online' | 'offline' | 'degraded'
  response_time_ms: number | null
  status_code?: number
  error?: string
}

/**
 * Check HTTP/HTTPS endpoint availability
 */
export async function checkHttp(
  url: string,
  logger: Logger,
  timeout = 10000
): Promise<HttpResult> {
  const startTime = Date.now()

  try {
    const response = await axios.get(url, {
      timeout,
      validateStatus: () => true, // Don't throw on any status code
      maxRedirects: 5,
      headers: {
        'User-Agent': 'IT-Dashboard-Agent/1.0',
      },
    })

    const responseTime = Date.now() - startTime
    const statusCode = response.status

    // Determine status based on HTTP status code
    let status: HttpResult['status']
    if (statusCode >= 200 && statusCode < 400) {
      status = 'online'
    } else if (statusCode >= 400 && statusCode < 500) {
      // Client errors might indicate the service is up but misconfigured
      status = 'degraded'
    } else if (statusCode >= 500) {
      // Server errors
      status = 'degraded'
    } else {
      status = 'online'
    }

    logger.debug(`HTTP ${url}: ${status} (${statusCode}, ${responseTime}ms)`)

    return {
      url,
      status,
      response_time_ms: responseTime,
      status_code: statusCode,
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    let errorMsg: string

    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        errorMsg = 'Connection timeout'
      } else if (error.code === 'ECONNREFUSED') {
        errorMsg = 'Connection refused'
      } else if (error.code === 'ENOTFOUND') {
        errorMsg = 'DNS lookup failed'
      } else if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
        errorMsg = 'SSL certificate error'
      } else {
        errorMsg = error.message
      }
    } else {
      errorMsg = error instanceof Error ? error.message : 'Unknown error'
    }

    logger.debug(`HTTP ${url}: offline (${errorMsg})`)

    return {
      url,
      status: 'offline',
      response_time_ms: responseTime > timeout ? null : responseTime,
      error: errorMsg,
    }
  }
}

/**
 * Check multiple HTTP endpoints concurrently
 */
export async function checkHttpEndpoints(
  urls: string[],
  logger: Logger,
  concurrency = 5
): Promise<HttpResult[]> {
  const results: HttpResult[] = []
  const queue = [...urls]

  logger.debug(`Checking ${urls.length} HTTP endpoints with concurrency ${concurrency}`)

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const url = queue.shift()
        if (url) {
          const result = await checkHttp(url, logger)
          results.push(result)
        }
      }
    })

  await Promise.all(workers)

  const online = results.filter(r => r.status === 'online').length
  const degraded = results.filter(r => r.status === 'degraded').length
  logger.debug(`HTTP check complete: ${online} online, ${degraded} degraded, ${results.length - online - degraded} offline`)

  return results
}
