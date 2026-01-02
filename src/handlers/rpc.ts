import { cacheResponse, calculateCacheKey, getCachedResponse, getCacheTtl } from '@/services'
import type { AnalyticsData } from '@/types'
import { getContentLength, trackRequest } from '@/utils'

// Global round-robin is now handled by DO or per-request within DO

export async function handleRequest(
  chain: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  const startTime = performance.now()

  // Analytics data we'll populate as we go
  let method = 'unknown'
  let isValidRpc = false
  let cacheStatus: AnalyticsData['cacheStatus'] = 'NONE'
  let requestSize = 0

  // Try caching only if we have a context (sanity check)
  let cachedResponse: Response | null = null
  let cacheKeyUrl: string | null = null
  let ttl = 0

  // Clone request to read body
  // We need multiple clones for retries
  const requestBodyClone = request.clone()

  try {
    if (request.method === 'POST') {
      try {
        const bodyText = await requestBodyClone.text()
        requestSize = bodyText.length

        const parsed = JSON.parse(bodyText)

        // Validate JSON-RPC 2.0
        // Handle Batch
        if (Array.isArray(parsed)) {
          if (
            parsed.length > 0 &&
            parsed.every(
              (p: unknown) =>
                typeof p === 'object' &&
                p !== null &&
                'jsonrpc' in p &&
                (p as { jsonrpc: unknown }).jsonrpc === '2.0' &&
                'method' in p &&
                typeof (p as { method: unknown }).method === 'string'
            )
          ) {
            isValidRpc = true
            method = 'batch'
          }
        }
        // Handle Single
        else if (parsed?.jsonrpc === '2.0' && typeof parsed?.method === 'string') {
          isValidRpc = true
          method = parsed.method

          const requestBody = parsed as { method: string; params: unknown[] }
          ttl = getCacheTtl(requestBody.method, requestBody.params)

          if (ttl > 0 && ctx) {
            cacheKeyUrl = await calculateCacheKey(chain, requestBody)
            cachedResponse = await getCachedResponse(cacheKeyUrl)
            cacheStatus = cachedResponse ? 'HIT' : 'MISS'
          } else {
            cacheStatus = 'BYPASS'
          }
        }
      } catch (_) {
        // Invalid JSON, proceed without caching
      }
    }
  } catch (_) {
    // Cloning error or something, ignore caching
  }

  if (cachedResponse) {
    const response = new Response(cachedResponse.body, cachedResponse)
    response.headers.set('X-NullRPC-Cache', 'HIT')

    // Track cached response
    if (ctx && isValidRpc) {
      trackRequest(env, ctx, {
        cacheStatus: 'HIT',
        chain,
        latencyMs: performance.now() - startTime,
        method,
        requestSize,
        responseSize: getContentLength(response.headers),
        statusCode: response.status
      })
    }

    return response
  }

  const id = env.CHAIN_DO.idFromName(chain)
  const stub = env.CHAIN_DO.get(id)

  const response = await stub.fetch(request.clone())

  // Get response size for analytics
  const responseSize = getContentLength(response.headers)

  // Track the request
  if (ctx && isValidRpc) {
    const successful = response.ok

    trackRequest(env, ctx, {
      cacheStatus: cacheStatus === 'HIT' ? 'HIT' : ttl > 0 ? 'MISS' : 'BYPASS',
      chain,
      errorType: successful ? undefined : `upstream_${response.status}`,
      latencyMs: performance.now() - startTime,
      method,
      requestSize,
      responseSize,
      statusCode: response.status
    })
  }

  // Save to cache if applicable
  if (ctx && cacheKeyUrl && ttl > 0 && response.ok) {
    // Warning: Respone body might be consumed?
    // DO fetch returns a new Response, but we should double check if cloning is needed for caching
    ctx.waitUntil(cacheResponse(cacheKeyUrl, response.clone(), ttl, ctx))
  }

  return response
}
