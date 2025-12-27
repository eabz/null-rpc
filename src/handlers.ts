import { CHAIN_NODES, type ChainId } from './constants'
import { createJsonResponse, createRawJsonResponse } from './response'

// Stateless Round-Robin (Random)
function chooseNode(nodes: string[]): string {
  return nodes[Math.floor(Math.random() * nodes.length)]
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

export async function handlePublicRequest(chain: string, request: Request, env: Env): Promise<Response> {
  const nodes = CHAIN_NODES[chain as ChainId]

  if (!nodes || nodes.length === 0) {
    return createJsonResponse(
      {
        error: `Chain ${chain} not supported or no nodes available`
      },
      404
    )
  }

  const nodeUrl = chooseNode(nodes)

  return proxyRequest(nodeUrl, request, env.NULLRPC_AUTH)
}

export async function handleAuthenticatedRequest(
  chain: string,
  token: string,
  request: Request,
  env: Env
): Promise<Response> {
  // 1. Get the Durable Object stub for this user (token)
  // We use the token string itself as the name to get a stable ID
  const id = env.USER_SESSION.idFromName(token)
  const session = env.USER_SESSION.get(id)

  // 2. Check limits
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

  // 3. Proxy request if allowed
  return handlePublicRequest(chain, request, env)
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
  } catch (_) {
    // Fallback error
    return createJsonResponse({ error: 'Upstream error' }, 502)
  }
}
