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

export async function handlePublicRequest(chain: string, request: Request): Promise<Response> {
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

  return proxyRequest(nodeUrl, request)
}

export function handleAuthenticatedRequest(chain: string, _token: string, request: Request): Promise<Response> {
  // Logic is currently same as public, but we might validate token later.
  // For now, just forward to the chain nodes.

  // TODO: Validate token here if needed in future

  return handlePublicRequest(chain, request)
}

async function proxyRequest(targetUrl: string, originalRequest: Request): Promise<Response> {
  // We strictly only forward POST for RPC usually, but generic proxying:
  // We Clone the method and body.
  // We strip headers to ensure privacy, only sending essential ones.

  try {
    const cleanHeaders = new Headers()
    cleanHeaders.set('Content-Type', 'application/json')
    cleanHeaders.set('Accept', 'application/json')

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
