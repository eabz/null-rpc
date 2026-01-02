import { DurableObject } from 'cloudflare:workers'

interface ChainData {
  id: number
  slug: string
  chainId: number
  nodes: string[]
  archive_nodes: string[]
  mev_nodes: string[]
}

export class ChainDO extends DurableObject<Env> {
  // Simple in-memory cache for chain data
  private chainData: ChainData | null = null
  private lastSync = 0
  private readonly SYNC_INTERVAL = 60_000 // 1 minute

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const chainSlug = url.pathname.split('/')[1]

    await this.ensureChainData(chainSlug)

    if (!this.chainData) {
      return new Response(`Chain ${chainSlug} not configured in DB`, { status: 404 })
    }

    // -------------------------------------------------------------------------
    // Privacy & Security: Payload Sanitization
    // -------------------------------------------------------------------------
    // We read the body text once to:
    // 1. Inspect 'method' for routing (MEV, Archive, etc)
    // 2. STRIP any non-standard fields (tracking tokens, metadata) from the JSON
    // 3. Reconstruct a clean request to send upstream

    let method = 'unknown'
    let params: unknown[] = []
    let requestToUse: Request

    const rawText = await request.text()

    try {
      const parsed = JSON.parse(rawText)
      let sanitized: unknown

      if (Array.isArray(parsed)) {
        // Batch Request: Sanitize every item
        sanitized = parsed.map((p: any) => ({
          id: p.id,
          jsonrpc: '2.0',
          method: p.method,
          params: p.params
        }))
        // Note: We don't inspect batch methods for routing yet, defaults to standard
      } else {
        // Single Request: Sanitize
        sanitized = {
          id: parsed.id,
          jsonrpc: '2.0',
          method: parsed.method,
          params: parsed.params
        }
        method = parsed.method || 'unknown'
        params = parsed.params || []
      }

      // Create new request with clean payload
      requestToUse = new Request(request.url, {
        body: JSON.stringify(sanitized),
        headers: request.headers,
        method: request.method
      })
    } catch (_) {
      // JSON parse failed: Forward raw text (upstream will likely reject it)
      requestToUse = new Request(request.url, {
        body: rawText,
        headers: request.headers,
        method: request.method
      })
    }

    // Determine request type for smart routing
    const routingType = this.determineRoutingType(method, params)

    // Route based on type, passing the SANITIZED request
    switch (routingType) {
      case 'mev':
        return this.handleMevRequest(requestToUse)
      case 'archive':
        return this.handleArchiveRequest(requestToUse, chainSlug)
      default:
        return this.handleStandardRequest(requestToUse, chainSlug)
    }
  }

  /**
   * Determine the routing type based on method and params
   */
  private determineRoutingType(method: string, params: unknown[]): 'mev' | 'archive' | 'standard' {
    // MEV protection for raw transactions
    if (method === 'eth_sendRawTransaction') {
      return 'mev'
    }

    // Archive methods - traces and debug
    if (method.startsWith('trace_') || method.startsWith('debug_') || method === 'eth_getLogs') {
      return 'archive'
    }

    // Check for old block references in params
    if (this.requiresArchiveNode(method, params)) {
      return 'archive'
    }

    return 'standard'
  }

  /**
   * Check if the request requires an archive node based on block params
   */
  private requiresArchiveNode(method: string, params: unknown[]): boolean {
    // Methods that take a block parameter
    const blockMethods = ['eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getStorageAt', 'eth_call']

    if (!blockMethods.includes(method)) return false

    // Check last param for block reference
    const lastParam = params[params.length - 1]
    if (typeof lastParam === 'string') {
      // "earliest" or specific old block numbers need archive
      if (lastParam === 'earliest') return true
      // Hex block number - if it's a low number, likely needs archive
      if (lastParam.startsWith('0x')) {
        const blockNum = Number.parseInt(lastParam, 16)
        // Consider blocks older than 128 as needing archive (safe head distance)
        if (blockNum > 0 && blockNum < 15000000) return true // Rough heuristic for ETH
      }
    }

    return false
  }

  /**
   * Handle MEV-protected transactions
   */
  private async handleMevRequest(request: Request): Promise<Response> {
    const mevNodes = this.chainData?.mev_nodes || []

    // Try MEV nodes first
    if (mevNodes.length > 0) {
      const shuffled = [...mevNodes].sort(() => 0.5 - Math.random())
      for (const nodeUrl of shuffled.slice(0, 2)) {
        const response = await this.proxyRequest(nodeUrl, request.clone())
        if (response.ok) return response
      }
    }

    // Fallback to regular nodes if MEV nodes fail or don't exist
    const nodes = this.chainData?.nodes || []
    if (nodes.length === 0) {
      return new Response(JSON.stringify({ error: 'No nodes available' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503
      })
    }

    const shuffled = [...nodes].sort(() => 0.5 - Math.random())
    for (const nodeUrl of shuffled.slice(0, 3)) {
      const response = await this.proxyRequest(nodeUrl, request.clone())
      if (response.ok) return response
    }

    return new Response(JSON.stringify({ error: 'All nodes failed for transaction' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 502
    })
  }

  /**
   * Handle archive-specific requests
   */
  private async handleArchiveRequest(request: Request, chainSlug: string): Promise<Response> {
    const archiveNodes = this.chainData?.archive_nodes || []

    if (archiveNodes.length === 0) {
      // Fall back to regular nodes - they might work for some requests
      return this.handleStandardRequest(request, chainSlug)
    }

    const shuffled = [...archiveNodes].sort(() => 0.5 - Math.random())
    for (const nodeUrl of shuffled.slice(0, 3)) {
      const response = await this.proxyRequest(nodeUrl, request.clone())
      if (response.ok) return response
    }

    // Fallback to standard nodes
    return this.handleStandardRequest(request, chainSlug)
  }

  /**
   * Handle standard requests
   */
  private async handleStandardRequest(request: Request, chainSlug: string): Promise<Response> {
    const nodes = this.chainData?.nodes || []

    if (nodes.length === 0) {
      return new Response(JSON.stringify({ error: `No nodes available for ${chainSlug}` }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503
      })
    }

    const shuffled = [...nodes].sort(() => 0.5 - Math.random())
    for (const nodeUrl of shuffled.slice(0, 3)) {
      const response = await this.proxyRequest(nodeUrl, request.clone())
      if (response.ok) return response
    }

    return new Response(JSON.stringify({ error: 'All upstream nodes failed' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 502
    })
  }

  private async ensureChainData(slug: string) {
    const now = Date.now()
    if (this.chainData && now - this.lastSync < this.SYNC_INTERVAL) {
      return
    }

    // Load from D1
    try {
      const result = await this.env.DB.prepare('SELECT * FROM chains WHERE slug = ?').bind(slug).first()

      if (result) {
        this.chainData = {
          archive_nodes: JSON.parse((result.archive_nodes as string) || '[]'),
          chainId: result.chainId as number,
          id: result.id as number,
          mev_nodes: result.mev_protection ? JSON.parse(result.mev_protection as string) : [],
          nodes: JSON.parse((result.nodes as string) || '[]'),
          slug: result.slug as string
        }
        this.lastSync = now
      } else {
        // If not found, maybe we should seed it? Or just return null.
        this.chainData = null
      }
    } catch (e) {
      console.error('Failed to load chain data from D1', e)
      // Keep old data if available on error?
      if (!this.chainData) {
        this.chainData = null
      }
    }
  }

  private async proxyRequest(targetUrl: string, originalRequest: Request): Promise<Response> {
    try {
      const cleanHeaders = new Headers()
      cleanHeaders.set('Content-Type', 'application/json')
      cleanHeaders.set('Accept', 'application/json')
      cleanHeaders.set('User-Agent', 'NullRPC/1.0')

      const response = await fetch(targetUrl, {
        body: originalRequest.body,
        headers: cleanHeaders,
        method: originalRequest.method
      })

      if (!response.ok) {
        console.warn(`[Proxy] Node failed: ${targetUrl} | Status: ${response.status} | ${response.statusText}`)
      }

      return response
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      console.error(`[Proxy] Connection error to ${targetUrl}:`, errorMessage)

      return new Response(JSON.stringify({ details: errorMessage, error: 'Upstream connection failed' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 502
      })
    }
  }
}
