import { DurableObject } from 'cloudflare:workers'

interface ChainData {
  id: number
  slug: string
  chainId: number
  nodes: string[]
  archive_nodes: string[]
  mev_protection?: string
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
    const chainSlug = url.pathname.split('/')[1] // Assuming /:chain format incoming, or we pass it
    // Actually, DO URL is usually http://do/path, so maybe we pass slug in header or just rely on state.

    // Better: Helper method to ensure data is loaded
    await this.ensureChainData(chainSlug)

    if (!this.chainData) {
      return new Response(`Chain ${chainSlug} not configured in DB`, { status: 404 })
    }

    // Clone request for inspection
    const clone = request.clone()
    let method = 'unknown'
    let isArchive = false

    try {
      const body = (await clone.json()) as { method?: string; params?: unknown[] }
      if (body?.method) {
        method = body.method
        // Basic archive detection (can be improved)
        if (method.includes('getLog') || method.includes('trace') || method.includes('debug')) {
          isArchive = true
        }
        // eth_call or eth_getBalance with "earliest" or specific old block also implies archive often,
        // but let's stick to simple method checks for now as requested.
      }
    } catch (_) {
      // Ignore JSON parse errors here, upstream will handle or proxy simple requests
    }

    // Select nodes
    const nodes = isArchive ? this.chainData.archive_nodes : this.chainData.nodes
    if (!nodes || nodes.length === 0) {
      return new Response(
        JSON.stringify({ error: `No ${isArchive ? 'archive ' : ''}nodes available for ${chainSlug}` }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // MEV Protection Check (only for transactions on Mainnet/supported chains)
    // If method is eth_sendRawTransaction and we have MEV protection configured
    if (method === 'eth_sendRawTransaction' && this.chainData.mev_protection) {
      try {
        const response = await this.proxyRequest(this.chainData.mev_protection, request.clone())
        if (response.ok) return response
        // If MEV protection fails, we likely SHOULD fail or fallback depending on policy.
        // Usually fail-safe for privacy.
        return response
      } catch (e) {
        return new Response(JSON.stringify({ error: 'MEV Protection Error' }), { status: 502 })
      }
    }

    // Round-Robin / Random Selection with Retry
    // We try up to 3 nodes
    const maxRetries = 3
    let lastError: Response | null = null

    // Simple shuffle for this request
    const shuffled = [...nodes].sort(() => 0.5 - Math.random())
    const selectedNodes = shuffled.slice(0, maxRetries)

    for (const nodeUrl of selectedNodes) {
      const response = await this.proxyRequest(nodeUrl, request.clone())
      if (response.ok) {
        return response
      }
      lastError = response
    }

    return (
      lastError ||
      new Response(JSON.stringify({ error: 'All upstream nodes failed' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      })
    )
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
          id: result.id as number,
          slug: result.slug as string,
          chainId: result.chainId as number,
          nodes: JSON.parse(result.nodes as string),
          archive_nodes: JSON.parse(result.archive_nodes as string),
          mev_protection: result.mev_protection as string | undefined
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
      // Maybe forward some safe headers?

      const response = await fetch(targetUrl, {
        body: originalRequest.body,
        headers: cleanHeaders,
        method: originalRequest.method
      })

      return response
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error'
      return new Response(JSON.stringify({ error: 'Upstream connection failed', details: errorMessage }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
}
