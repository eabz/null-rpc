import { createJsonResponse, createRawJsonResponse } from './response'

const ROOT_BODY = JSON.stringify({
  id: 1,
  jsonrpc: '2.0',
  result: true
})

export function handleRoot(): Response {
  return createRawJsonResponse(ROOT_BODY)
}

export function handlePublicRequest(chain: string): Response {
  // TODO: Implement actual proxy logic for public endpoints
  return createJsonResponse({
    access: 'public',
    chain,
    message: `Public request for chain: ${chain}`
  })
}

export function handleAuthenticatedRequest(chain: string, token: string): Response {
  // TODO: Implement actual proxy logic for authenticated endpoints
  return createJsonResponse({
    access: 'authenticated',
    chain,
    message: `Authenticated request for chain: ${chain}`,
    token
  })
}
