import { handleAuthenticatedRequest, handleRequest, handleRoot } from './handlers'

/**
 * High-performance Cloudflare Worker entry point.
 *
 * Implements a custom router using manual string parsing instead of `URL.pathname.split('/')`
 * to minimize garbage collection usage on hot paths.
 *
 * Routes supported:
 * - `/`                  -> Base health check (root handler)
 * - `/:chain`            -> Public chain access (e.g. /eth, /bsc)
 * - `/:chain/:token`     -> Authenticated access (e.g. /eth/123-abc)
 */
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

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

      return checkRateLimitAndHandlePublic(chain, request, env, ctx)
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
        return checkRateLimitAndHandlePublic(chain, request, env, ctx)
      }

      return handleAuthenticatedRequest(chain, token, request, env, ctx)
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
    return handleAuthenticatedRequest(chain, token, request, env, ctx)
  }
} satisfies ExportedHandler<Env>

export { UserSession } from './objects/session'

async function checkRateLimitAndHandlePublic(
  chain: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const { success } = await env.RATE_LIMITER.limit({ key: ip })

  if (!success) {
    return new Response('Rate Limit Exceeded', { status: 429 })
  }

  return handleRequest(chain, request, env, undefined, ctx)
}
