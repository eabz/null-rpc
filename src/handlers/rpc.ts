import { CHAIN_NODES, type ChainId, MEV_PROTECTION, PUBLIC_NODES } from '@/constants'
import { cacheResponse, calculateCacheKey, getCachedResponse, getCacheTtl } from '@/services'
import type { AnalyticsData } from '@/types'
import { createJsonResponse, getContentLength, trackRequest } from '@/utils'

// Global round-robin counter for node selection
let roundRobinIndex = 0

// True Round-Robin: cycles through nodes in order
function chooseNode(nodes: string[]): string {
  const index = roundRobinIndex % nodes.length
  roundRobinIndex++
  return nodes[index]
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
  let isMevProtection = false

  if (method === 'eth_sendRawTransaction' && mevEndpoint) {
    // Route transaction submissions through MEV protection
    nodeUrl = mevEndpoint
    isMevProtection = true
  } else {
    // Normal round-robin for other methods
    nodeUrl = chooseNode(nodes)
  }

  // Attempt 1: Primary Node
  let response = await proxyRequest(nodeUrl, request.clone(), env.NULLRPC_AUTH)

  // Retry Logic
  // If failed AND not MEV protection (fail fast for MEV to avoid accidental public broadcast)
  if (!response.ok && !isMevProtection) {
    const publicNodes = PUBLIC_NODES[chain as ChainId] || []

    // We try up to 5 times with random public nodes
    const maxRetries = 5
    let attempts = 0

    while (!response.ok && attempts < maxRetries && publicNodes.length > 0) {
      attempts++
      const randomNode = publicNodes[Math.floor(Math.random() * publicNodes.length)]
      // console.log(`Retry ${attempts}/${maxRetries} using ${randomNode}`)

      response = await proxyRequest(randomNode, request.clone(), env.NULLRPC_AUTH)

      if (response.ok) {
        break
      }
    }
  }

  // Get response size for analytics
  const responseSize = getContentLength(response.headers)

  // Check for upstream errors (final status)
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

  // 1. Get the User Session Actor (Per-User)
  // Each user gets their own DO for infinite scalability
  const id = env.USER_SESSION.idFromName(token)
  const session = env.USER_SESSION.get(id)

  // 2. Check rate limits (token bucket in memory)
  const { allowed, reason } = await session.checkLimit(token)

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
