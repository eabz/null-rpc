/**
 * Cron service for fetching, validating, and storing public RPC nodes.
 * Runs every 10 minutes via Cloudflare Workers scheduled handler.
 */

const CHAINLIST_API = 'https://chainlist.org/rpcs.json'

// Whitelisted MEV protection nodes per chain
const MEV_NODES: Record<string, string[]> = {
  eth: [
    'https://eth.merkle.io',
    'https://rpc.mevblocker.io/fullprivacy'
  ]
}

// Target chains with their expected chain IDs
const TARGET_CHAINS: Record<string, number> = {
  eth: 1,
  bsc: 56,
  polygon: 137,
  base: 8453,
  unichain: 130,
  optimism: 10,
  arbitrum: 42161,
  plasma: 9745,
  katana: 747474,
  berachain: 80094
}

interface ChainlistRpc {
  url: string
  tracking?: string
  isOpenSource?: boolean
}

interface ChainlistEntry {
  name: string
  chain: string
  chainId: number
  shortName?: string
  rpc: (string | ChainlistRpc)[]
  [key: string]: unknown
}

interface ValidatedNode {
  url: string
  isArchive: boolean
}

/**
 * Fetch all chains from chainlist API
 */
async function fetchChainlist(): Promise<ChainlistEntry[]> {
  const response = await fetch(CHAINLIST_API, {
    headers: { 'Accept': 'application/json' }
  })

  if (!response.ok) {
    throw new Error(`Chainlist API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Extract HTTP RPC URLs from a chainlist entry
 */
function extractRpcUrls(entry: ChainlistEntry): string[] {
  const urls: string[] = []

  for (const rpc of entry.rpc) {
    const url = typeof rpc === 'string' ? rpc : rpc.url

    // Skip WebSocket URLs and URLs with placeholder variables
    if (url.startsWith('wss://') || url.includes('${')) {
      continue
    }

    // Only include HTTP(S) URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      urls.push(url)
    }
  }

  return urls
}

/**
 * Test if an RPC endpoint returns the expected chain ID
 */
async function testChainId(url: string, expectedChainId: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000) // Reduced timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) return false

    const data = await response.json() as { result?: string; error?: unknown }

    if (data.error || !data.result) return false

    // Parse hex chain ID
    const chainId = Number.parseInt(data.result, 16)
    return chainId === expectedChainId
  } catch {
    return false
  }
}

/**
 * Test if an RPC endpoint has archive node capabilities
 * by requesting balance at block 1
 */
async function testArchiveCapability(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000) // Reduced timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: ['0x0000000000000000000000000000000000000000', '0x1'], // Block 1
        id: 1
      }),
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) return false

    const data = await response.json() as { result?: string; error?: unknown }

    // Archive nodes can serve historical state, so they return a result
    // Non-archive nodes typically return an error about missing trie node
    return !data.error && typeof data.result === 'string'
  } catch {
    return false
  }
}
/**
 * Validate all RPC URLs for a chain and categorize as regular or archive nodes
 */
async function validateChainNodes(
  rpcUrls: string[],
  expectedChainId: number
): Promise<{ nodes: string[]; archiveNodes: string[] }> {
  const nodes: string[] = []
  const archiveNodes: string[] = []

  // Heavy batch - test all nodes in parallel for speed
  // Cloudflare charges for compute time, not requests
  const results = await Promise.allSettled(
    rpcUrls.map(async (url) => {
      // Run chainId and archive tests concurrently
      const [validChainId, isArchive] = await Promise.all([
        testChainId(url, expectedChainId),
        testArchiveCapability(url)
      ])

      if (!validChainId) return null
      return { url, isArchive }
    })
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      nodes.push(result.value.url)
      if (result.value.isArchive) {
        archiveNodes.push(result.value.url)
      }
    }
  }

  return { nodes, archiveNodes }
}

/**
 * Store validated nodes in D1 database
 */
async function storeChainData(
  db: D1Database,
  slug: string,
  name: string,
  chainId: number,
  nodes: string[],
  archiveNodes: string[],
  mevNodes: string[]
): Promise<void> {
  const nodesJson = JSON.stringify(nodes)
  const archiveNodesJson = JSON.stringify(archiveNodes)
  const mevNodesJson = JSON.stringify(mevNodes)

  await db
    .prepare(
      `INSERT INTO chains (slug, name, chainId, nodes, archive_nodes, mev_protection, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name,
         chainId = excluded.chainId,
         nodes = excluded.nodes,
         archive_nodes = excluded.archive_nodes,
         mev_protection = excluded.mev_protection,
         updated_at = unixepoch()`
    )
    .bind(slug, name, chainId, nodesJson, archiveNodesJson, mevNodesJson)
    .run()
}

/**
 * Main sync function - validates and stores top 20 chains by TVL
 */
export async function syncPublicNodes(env: Env): Promise<void> {
  console.log('[Cron] Starting public node sync...')

  const TOP_CHAINS_COUNT = 50

  try {
    // Fetch all chains from chainlist
    const chains = await fetchChainlist()
    console.log(`[Cron] Fetched ${chains.length} chains from chainlist`)

    // Filter to valid mainnet chains with TVL data and enough RPCs
    const validChains = chains
      .filter((chainEntry) => {
        if (!chainEntry.shortName) return false
        const isTestnet = (chainEntry as { isTestnet?: boolean }).isTestnet === true
        if (isTestnet) return false
        const rpcUrls = extractRpcUrls(chainEntry)
        // Must have more than 5 RPC endpoints to filter out small/unused chains
        if (rpcUrls.length <= 5) return false
        // Must have TVL data
        const tvl = (chainEntry as { tvl?: number }).tvl
        return typeof tvl === 'number' && tvl > 0
      })
      // Sort by TVL descending
      .sort((a, b) => {
        const tvlA = (a as { tvl?: number }).tvl || 0
        const tvlB = (b as { tvl?: number }).tvl || 0
        return tvlB - tvlA
      })
      // Take top N
      .slice(0, TOP_CHAINS_COUNT)

    console.log(`[Cron] Processing top ${validChains.length} chains by TVL`)

    let processed = 0
    let failed = 0

    for (const chainEntry of validChains) {
      const slug = chainEntry.shortName!.toLowerCase()
      const chainId = chainEntry.chainId
      const rpcUrls = extractRpcUrls(chainEntry)
      const tvl = (chainEntry as { tvl?: number }).tvl || 0

      console.log(`[Cron] ${slug} (TVL: $${(tvl / 1e9).toFixed(2)}B): Testing ${rpcUrls.length} RPCs...`)

      try {
        // Validate nodes with full testing
        const { nodes, archiveNodes } = await validateChainNodes(rpcUrls, chainId)

        if (nodes.length > 0) {
          // Get whitelisted MEV nodes for this chain (if any)
          const mevNodes = MEV_NODES[slug] || []

          // Store in D1
          await storeChainData(env.DB, slug, chainEntry.name, chainId, nodes, archiveNodes, mevNodes)
          processed++
          console.log(`[Cron] ${slug}: ${nodes.length} valid, ${archiveNodes.length} archive`)
        } else {
          console.log(`[Cron] ${slug}: No valid nodes found`)
          failed++
        }
      } catch (e) {
        console.error(`[Cron] Error processing ${slug}:`, e)
        failed++
      }
    }

    console.log(`[Cron] Sync complete: ${processed} chains stored, ${failed} failed`)
  } catch (error) {
    console.error('[Cron] Public node sync failed:', error)
    throw error
  }
}

