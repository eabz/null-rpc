import { handleAnalytics, handleChainPage, handleChains, handleRequest, handleRoot } from '@/handlers'
import { syncPublicNodes } from '@/services'

export { ChainDO } from './objects/chain'

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
 * Strip ALL headers except the absolute essentials.
 * We store the IP for rate limiting before this step, so we can now
 * completely sanitize the request to ensure zero metadata leakage.
 *
 * Whitelisted Headers:
 * - content-type: Required for JSON-RPC parsing
 * - accept: Required for content negotiation
 */
function stripPrivacyHeaders(request: Request): Request {
  const headers = new Headers()

  // Whitelist only essential headers
  const whitelist = ['content-type', 'accept']
  for (const key of whitelist) {
    const value = request.headers.get(key)
    if (value) headers.set(key, value)
  }

  // Create a new request with ONLY the whitelisted headers
  // All other headers (CF-*, User-Agent, Cookie, Referer, etc) are dropped.
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
    // 1. Static assets - let Cloudflare handle them
    // -------------------------------------------------------------------------
    // Files with extensions (e.g., .png, .ico, .html) are handled by Cloudflare's assets
    const lastSegment = path.split('/').pop() || ''
    const hasExtension = lastSegment.includes('.')

    if (hasExtension || path === '/' || path === '') {
      // For root URL, the assets config will serve index.html
      // For files, assets config serves from public/
      // biome-ignore lint/style/useNamingConvention: exact type required
      const assets = (env as unknown as { ASSETS?: { fetch: (req: Request) => Promise<Response> } }).ASSETS
      if (assets) {
        return assets.fetch(request)
      }
      // Fallback if no assets binding (local dev without assets)
      if (path === '/' || path === '') {
        return handleRoot()
      }
    }

    // -------------------------------------------------------------------------
    // 2. Chains info endpoint
    // -------------------------------------------------------------------------
    if (path === '/chains') {
      return handleChains(env)
    }

    // -------------------------------------------------------------------------
    // 3. Analytics endpoint
    // -------------------------------------------------------------------------
    if (path.startsWith('/analytics')) {
      return handleAnalytics(request, env)
    }

    // -------------------------------------------------------------------------
    // 4. Zero-allocation routing logic
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

      // GET requests serve the chain analytics page
      if (request.method === 'GET') {
        const chainPage = await handleChainPage(chain, env)
        if (chainPage) return chainPage
        // If chain not found, return 404
        return new Response('Chain not found', { status: 404 })
      }

      // POST requests are RPC calls
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
    }

    return new Response('Not Found', { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Run the public nodes sync
    // Note: In local dev, this may show "exception" but works correctly in production
    ctx.waitUntil(syncPublicNodes(env))
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
