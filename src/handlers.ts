import { cacheResponse, calculateCacheKey, getCachedResponse, getCacheTtl } from './cache'
import { CHAIN_NODES, type ChainId } from './constants'
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
  ctx?: ExecutionContext
): Promise<Response> {
  // Try caching only if we have a context (sanity check)
  // We need to clone the request because we read the body for caching key
  // and then we need to pass a fresh request to fetch.
  // BUT: `proxyRequest` also expects a request.

  let cachedResponse: Response | null = null
  let cacheKeyUrl: string | null = null
  let ttl = 0

  // clone request to read body
  const requestClone = request.clone()

  try {
    if (request.method === 'POST') {
      try {
        const requestBody: { method: string; params: any[] } = await requestClone.json()
        // Check if we should cache this method
        if (requestBody?.method) {
          ttl = getCacheTtl(requestBody.method, requestBody.params)
          if (ttl > 0 && ctx) {
            cacheKeyUrl = await calculateCacheKey(chain, requestBody)
            cachedResponse = await getCachedResponse(cacheKeyUrl)
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
    // Return cached response via a clone to keep the original stream in cache (if that matters, though Cache API returns fresh response)
    // We update headers?
    const response = new Response(cachedResponse.body, cachedResponse)
    response.headers.set('X-NullRPC-Cache', 'HIT')
    return response
  }

  const nodes: string[] = CHAIN_NODES[chain as ChainId] || []

  if (!nodes || nodes.length === 0) {
    return createJsonResponse(
      {
        error: `Chain ${chain} not supported or no nodes available`
      },
      404
    )
  }

  const nodeUrl = chooseNode(nodes)

  const response = await proxyRequest(nodeUrl, request, env.NULLRPC_AUTH)

  // Save to cache if applicable
  if (ctx && cacheKeyUrl && ttl > 0 && response.ok) {
    ctx.waitUntil(cacheResponse(cacheKeyUrl, response, ttl, ctx))
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
  // 0.  Validate Chain before checking limits to ensure we have node count
  const nodes = CHAIN_NODES[chain as ChainId]
  if (!nodes || nodes.length === 0) {
    return createJsonResponse(
      {
        error: `Chain ${chain} not supported or no nodes available`
      },
      404
    )
  }

  // 1. Get the Durable Object stub for this user (token)
  // We use the token string itself as the name to get a stable ID
  const id = env.USER_SESSION.idFromName(token)
  const session = env.USER_SESSION.get(id)

  // 2. Check rate limits
  const { allowed, reason } = await session.checkLimit()

  if (!allowed) {
    const status = reason === 'monthly_limit' ? 402 : 429
    return createJsonResponse(
      {
        error: reason === 'monthly_limit' ? 'Monthly limit exceeded' : 'Rate limit exceeded'
      },
      status
    )
  }

  // 3. Proxy request if allowed (round-robin node selection happens in handleRequest)
  return handleRequest(chain, request, env, ctx)
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
