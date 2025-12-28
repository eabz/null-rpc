import { cacheResponse, calculateCacheKey, getCachedResponse, getCacheTtl } from '@/services'
import type { AnalyticsData } from '@/types'
import { createJsonResponse, getContentLength, trackRequest } from '@/utils'

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
  let cacheStatus: AnalyticsData['cacheStatus'] = 'NONE'
  let errorType: string | undefined
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

        const requestBody: { method: string; params: unknown[] } = JSON.parse(bodyText)
        // Extract method for analytics
        if (requestBody?.method) {
          method = requestBody.method
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
        errorType = 'invalid_json'
      }
    }
  } catch (_) {
    // Cloning error or something, ignore caching
    errorType = 'request_error'
  }

  if (cachedResponse) {
    const response = new Response(cachedResponse.body, cachedResponse)
    response.headers.set('X-NullRPC-Cache', 'HIT')

    // Track cached response
    if (ctx) {
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
  if (ctx) {
     const successful = response.ok
     const finalError = successful ? undefined : 'opt_failed' // Or parse error

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


