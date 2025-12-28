import { handleAuthenticatedRequest, handleRequest, handleRoot } from '@/handlers'

export { UserSession } from './objects/session'

/**
 * High-performance Cloudflare Worker entry point.
 *
 * Implements a custom router using manual string parsing instead of `URL.pathname.split('/')`
 * to minimize garbage collection usage on hot paths.
 *
 * PRIVACY: We immediately strip all Cloudflare user-identifying headers
 * before processing any request to ensure no user data is leaked to upstream providers.
 *
 * Routes supported:
 * - `/`                  -> Base health check (root handler)
 * - `/:chain`            -> Public chain access (e.g. /eth, /bsc)
 * - `/:chain/:token`     -> Authenticated access (e.g. /eth/123-abc)
 */

/**
 * Strip all Cloudflare user-identifying headers from the request.
 * This ensures we never relay any user data to upstream RPC providers.
 *
 * Headers removed:
 * - cf-connecting-ip: Real client IP
 * - cf-ipcountry: Client country code
 * - cf-ray: Cloudflare request ID (can be correlated)
 * - cf-visitor: Protocol info
 * - x-forwarded-for: Proxy chain IPs
 * - x-forwarded-proto: Protocol
 * - x-real-ip: Real client IP
 * - true-client-ip: Enterprise real IP
 */
function stripPrivacyHeaders(request: Request): Request {
  const headers = new Headers(request.headers)

  // Remove all Cloudflare user-identifying headers
  headers.delete('cf-connecting-ip')
  headers.delete('cf-ipcountry')
  headers.delete('cf-ray')
  headers.delete('cf-visitor')
  headers.delete('cf-region')
  headers.delete('cf-region-code')
  headers.delete('cf-metro-code')
  headers.delete('cf-city')
  headers.delete('cf-postal-code')
  headers.delete('cf-latitude')
  headers.delete('cf-longitude')
  headers.delete('cf-timezone')
  headers.delete('x-forwarded-for')
  headers.delete('x-forwarded-proto')
  headers.delete('x-real-ip')
  headers.delete('true-client-ip')

  // Create a new request with cleaned headers
  return new Request(request.url, {
    body: request.body,
    headers,
    method: request.method,
    // Preserve other request properties
    redirect: request.redirect,
    signal: request.signal
  })
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // -------------------------------------------------------------------------
    // 0. Strip privacy headers IMMEDIATELY before any processing
    // -------------------------------------------------------------------------
    // We need the IP for rate limiting before stripping
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown'

    // Strip all user-identifying headers from the request
    const cleanRequest = stripPrivacyHeaders(request)

    // -------------------------------------------------------------------------
    // 1. Fast path for root requests
    // -------------------------------------------------------------------------
    if (path === '/' || path === '') {
      return handleRoot()
    }

    // -------------------------------------------------------------------------
    // 2. Zero-allocation routing logic
    // -------------------------------------------------------------------------
    // We manually extract path segments to avoid the overhead of `split('/').filter(Boolean)`.
    // The logic handles leading slashes, trailing slashes, and double slashes.

    // Skip leading slash (index 0) if present
    const start = path.charCodeAt(0) === 47 ? 1 : 0
    const nextSlash = path.indexOf('/', start)

    // CASE: "/:chain"
    // No second slash found, so the rest of the string is the chain identifier.
    if (nextSlash === -1) {
      const chain = path.slice(start)
      if (!chain) return handleRoot() // Handle "/" strictly if missed fast path

      return checkRateLimitAndHandlePublic(chain, cleanRequest, clientIp, env, ctx)
    }

    // Extract first segment: "chain"
    const chain = path.slice(start, nextSlash)
    if (!chain) {
      // CASE: "//foo" or "//"
      // Empty segment implies double slash or invalid path structure.
      return new Response('Not Found', { status: 404 })
    }

    // -------------------------------------------------------------------------
    // 3. Rate Limiting for Public Requests
    // -------------------------------------------------------------------------
    // Check for next segment: "token"
    const tokenStart = nextSlash + 1
    const tokenEnd = path.indexOf('/', tokenStart)

    // CASE: "/:chain/:token" (potentially with no trailing slash)
    if (tokenEnd === -1) {
      const token = path.slice(tokenStart)

      if (!token) {
        // CASE: "/:chain/"
        // Trailing slash after chain means it is still a public request.
        return checkRateLimitAndHandlePublic(chain, cleanRequest, clientIp, env, ctx)
      }

      return handleAuthenticatedRequest(chain, token, cleanRequest, env, ctx)
    }

    // Extract second segment: "token"
    const token = path.slice(tokenStart, tokenEnd)
    if (!token) {
      // CASE: "/:chain//"
      // Double slash in token position is invalid.
      return new Response('Not Found', { status: 404 })
    }

    // -------------------------------------------------------------------------
    // 4. Validation for extra segments
    // -------------------------------------------------------------------------
    // CASE: "/:chain/:token/something"
    // We strictly support only depth-2 for authenticated routes.
    const remainder = path.slice(tokenEnd + 1)

    if (remainder && remainder !== '/') {
      return new Response('Not Found', { status: 404 })
    }

    // CASE: "/:chain/:token/"
    // Valid authenticated request with trailing slash.
    return handleAuthenticatedRequest(chain, token, cleanRequest, env, ctx)
  }
} satisfies ExportedHandler<Env>

async function checkRateLimitAndHandlePublic(
  chain: string,
  request: Request,
  clientIp: string,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  // Use the pre-extracted IP since headers have been stripped from request
  const { success } = await env.RATE_LIMITER.limit({ key: clientIp })

  if (!success) {
    return new Response('Rate Limit Exceeded', { status: 429 })
  }

  return handleRequest(chain, request, env, ctx)
}
