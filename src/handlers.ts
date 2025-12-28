import { type AnalyticsData, getContentLength, trackRequest } from './analytics'
import { cacheResponse, calculateCacheKey, getCachedResponse, getCacheTtl } from './cache'
import { CHAIN_NODES, type ChainId, MEV_PROTECTION } from './constants'
import { createJsonResponse, createRawJsonResponse } from './response'

// Global round-robin counter for node selection
let roundRobinIndex = 0

// True Round-Robin: cycles through nodes in order
function chooseNode(nodes: string[]): string {
  const index = roundRobinIndex % nodes.length
  roundRobinIndex++
  return nodes[index]
}

export function handleRoot(): Response {
  return createRawJsonResponse(
    JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      result: true
    })
  )
}

export async function handleRequest(
  chain: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
  userType: 'public' | 'authenticated' = 'public',
  userToken?: string
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
  const requestClone = request.clone()

  try {
    if (request.method === 'POST') {
      try {
        const bodyText = await requestClone.text()
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
        statusCode: response.status,
        userToken,
        userType
      })
    }

    return response
  }

  const nodes: string[] = CHAIN_NODES[chain as ChainId] || []

  if (!nodes || nodes.length === 0) {
    const response = createJsonResponse({ error: `Chain ${chain} not supported or no nodes available` }, 404)
    errorType = 'chain_not_found'

    // Track error response
    if (ctx) {
      trackRequest(env, ctx, {
        cacheStatus,
        chain,
        errorType,
        latencyMs: performance.now() - startTime,
        method,
        requestSize,
        statusCode: 404,
        userToken,
        userType
      })
    }

    return response
  }

  // Choose endpoint: Use MEV protection for eth_sendRawTransaction
  let nodeUrl: string
  const mevEndpoint = MEV_PROTECTION[chain as ChainId]

  if (method === 'eth_sendRawTransaction' && mevEndpoint) {
    // Route transaction submissions through MEV protection
    nodeUrl = mevEndpoint
  } else {
    // Normal round-robin for other methods
    nodeUrl = chooseNode(nodes)
  }

  const response = await proxyRequest(nodeUrl, request, env.NULLRPC_AUTH)

  // Get response size for analytics
  const responseSize = getContentLength(response.headers)

  // Check for upstream errors
  if (!response.ok) {
    errorType = `upstream_${response.status}`
  }

  // Save to cache if applicable
  if (ctx && cacheKeyUrl && ttl > 0 && response.ok) {
    ctx.waitUntil(cacheResponse(cacheKeyUrl, response, ttl, ctx))
  }

  // Track the request
  if (ctx) {
    trackRequest(env, ctx, {
      cacheStatus: cacheStatus === 'HIT' ? 'HIT' : ttl > 0 ? 'MISS' : 'BYPASS',
      chain,
      errorType,
      latencyMs: performance.now() - startTime,
      method,
      requestSize,
      responseSize,
      statusCode: response.status,
      userToken,
      userType
    })
  }

  return response
}

export async function handleAuthenticatedRequest(
  chain: string,
  token: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const startTime = performance.now()

  // 0. Validate Chain before checking limits to ensure we have node count
  const nodes = CHAIN_NODES[chain as ChainId]
  if (!nodes || nodes.length === 0) {
    // Track the error
    trackRequest(env, ctx, {
      cacheStatus: 'NONE',
      chain,
      errorType: 'chain_not_found',
      latencyMs: performance.now() - startTime,
      method: 'unknown',
      statusCode: 404,
      userToken: token,
      userType: 'authenticated'
    })

    return createJsonResponse({ error: `Chain ${chain} not supported or no nodes available` }, 404)
  }

  // 1. Get the Global User Registry
  const id = env.USER_REGISTRY.idFromName('global')
  const registry = env.USER_REGISTRY.get(id)

  // 2. Check rate limits (passing the token)
  const { allowed, reason } = await registry.checkLimit(token)

  if (!allowed) {
    if (reason === 'user_not_found') {
      return createJsonResponse({ error: 'User not found' }, 404)
    }

    const status = reason === 'monthly_limit' ? 402 : 429
    const errorType = reason === 'monthly_limit' ? 'monthly_limit_exceeded' : 'rate_limit_exceeded'

    // Track the rate limit rejection
    trackRequest(env, ctx, {
      cacheStatus: 'NONE',
      chain,
      errorType,
      latencyMs: performance.now() - startTime,
      method: 'unknown',
      statusCode: status,
      userToken: token,
      userType: 'authenticated'
    })

    return createJsonResponse(
      { error: reason === 'monthly_limit' ? 'Monthly limit exceeded' : 'Rate limit exceeded' },
      status
    )
  }

  // 3. Proxy request if allowed - pass authenticated userType and token for tracking
  return handleRequest(chain, request, env, ctx, 'authenticated', token)
}

async function proxyRequest(targetUrl: string, originalRequest: Request, authHeader: string): Promise<Response> {
  // We strictly only forward POST for RPC usually, but generic proxying:
  // We Clone the method and body.
  // We strip headers to ensure privacy, only sending essential ones.

  try {
    const cleanHeaders = new Headers()
    cleanHeaders.set('Content-Type', 'application/json')
    cleanHeaders.set('Accept', 'application/json')
    if (authHeader) {
      cleanHeaders.set('X-NullRPC-Auth', authHeader)
    }

    const response = await fetch(targetUrl, {
      body: originalRequest.body,
      headers: cleanHeaders,
      method: originalRequest.method
    })

    // Return the upstream response directly
    // We might want to overwrite headers on the way back too?
    return response
  } catch (e) {
    // Fallback error with actual message for debugging
    const errorMessage = e instanceof Error ? e.message : 'Unknown error'
    return createJsonResponse({ details: errorMessage, error: 'Upstream error' }, 502)
  }
}

/**
 * Public stats endpoint
 *
 * Returns aggregate, non-sensitive statistics about the RPC service.
 * Full analytics data can be queried via Cloudflare Analytics Engine GraphQL API.
 *
 * Note: Real-time stats require querying Analytics Engine which is async.
 * This endpoint returns service metadata and explains how to access full stats.
 */
export function handleStats(env: Env): Response {
  // For real-time stats, you'd query Analytics Engine via GraphQL API
  // That requires an API token and should be done from a backend/scheduled worker
  //
  // Example GraphQL query:
  // query {
  //   viewer {
  //     accounts(filter: { accountTag: "ACCOUNT_ID" }) {
  //       rpcStats: analyticsEngineAdaptiveGroups(
  //         filter: { datetime_gt: "...", index: "rpc_requests" }
  //         limit: 10000
  //       ) {
  //         sum { double1 }  // Total requests
  //         avg { double2 }  // Avg latency
  //         dimensions { blob1 blob2 blob3 }  // chain, method, cache
  //       }
  //     }
  //   }
  // }

  const supportedChains = Object.keys(CHAIN_NODES)

  const response = {
    // How to access full analytics (privacy-focused: no external user data tracked)
    analytics: {
      dataset: 'nullrpc_metrics',
      dimensions: {
        blob1: 'chain',
        blob2: 'method',
        blob3: 'cacheStatus',
        blob4: 'userType',
        blob5: 'userToken',
        blob6: 'statusCode',
        blob7: 'errorType'
      },
      documentation: 'https://developers.cloudflare.com/analytics/analytics-engine/',
      enabled: !!env.ANALYTICS,
      metrics: {
        double1: 'requestCount',
        double2: 'latencyMs',
        double3: 'requestSize',
        double4: 'responseSize',
        double5: 'cacheHits',
        double6: 'errorCount',
        double7: 'rateLimitedCount'
      },
      privacyNote:
        'No geographic data (IP, country, region) is collected. Only our contextual data (userType, token) is tracked.',
      queryEndpoint: 'https://api.cloudflare.com/client/v4/graphql'
    },

    // Service capabilities
    capabilities: {
      analytics: !!env.ANALYTICS,
      caching: true,
      chains: supportedChains,
      rateLimiting: true
    },

    // Endpoints
    endpoints: {
      authenticatedRpc: '/:chain/:token',
      root: '/',
      rpc: '/:chain',
      stats: '/stats'
    },
    service: 'NullRPC',
    status: 'operational',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }

  return createJsonResponse(response, 200)
}
