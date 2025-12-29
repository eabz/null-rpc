/**
 * Cron service for fetching, validating, and storing public RPC nodes.
 * Runs every 10 minutes via Cloudflare Workers scheduled handler.
 */

const CHAINLIST_API = 'https://chainlist.org/rpcs.json'

// Whitelisted MEV protection nodes per chain
const MEV_NODES: Record<string, string[]> = {
  eth: ['https://eth.merkle.io', 'https://rpc.mevblocker.io/fullprivacy']
}

// Target chains with their expected chain IDs
const TARGET_CHAINS: Record<string, number> = {
  arbitrum: 42161,
  base: 8453,
  berachain: 80094,
  bsc: 56,
  eth: 1,
  katana: 747474,
  optimism: 10,
  plasma: 9745,
  polygon: 137,
  unichain: 130
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

/**
 * Fetch all chains from chainlist API
 */
async function fetchChainlist(): Promise<ChainlistEntry[]> {
  const response = await fetch(CHAINLIST_API, {
    headers: { Accept: 'application/json' }
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
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: []
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) return false

    const data = (await response.json()) as { result?: string; error?: unknown }

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
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: ['0x0000000000000000000000000000000000000000', '0x1'] // Block 1
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!response.ok) return false

    const data = (await response.json()) as { result?: string; error?: unknown }

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
      return { isArchive, url }
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

  return { archiveNodes, nodes }
}

/**
 * Store validated nodes in D1 database
 */
async function storeChainData(
  db: D1Database,
  slug: string,
  name: string,
  icon: string | undefined,
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
      `INSERT INTO chains (slug, name, icon, chainId, nodes, archive_nodes, mev_protection, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name,
         icon = excluded.icon,
         chainId = excluded.chainId,
         nodes = excluded.nodes,
         archive_nodes = excluded.archive_nodes,
         mev_protection = excluded.mev_protection,
         updated_at = unixepoch()`
    )
    .bind(slug, name, icon || null, chainId, nodesJson, archiveNodesJson, mevNodesJson)
    .run()
}

/**
 * Main sync function - validates and stores chains defined in TARGET_CHAINS
 */
export async function syncPublicNodes(env: Env): Promise<void> {
  console.log('[Cron] Starting public node sync...')

  try {
    // Fetch all chains from chainlist
    const chains = await fetchChainlist()
    console.log(`[Cron] Fetched ${chains.length} chains from chainlist`)

    // Create a map of chainId -> chainEntry for quick lookup
    const chainsByChainId = new Map<number, ChainlistEntry>()
    for (const chain of chains) {
      chainsByChainId.set(chain.chainId, chain)
    }

    let processed = 0
    let failed = 0

    // Process only chains defined in TARGET_CHAINS
    for (const [slug, expectedChainId] of Object.entries(TARGET_CHAINS)) {
      const chainEntry = chainsByChainId.get(expectedChainId)

      if (!chainEntry) {
        console.log(`[Cron] ${slug}: Chain ID ${expectedChainId} not found in chainlist`)
        failed++
        continue
      }

      const rpcUrls = extractRpcUrls(chainEntry)
      console.log(`[Cron] ${slug}: Testing ${rpcUrls.length} RPCs...`)

      if (rpcUrls.length === 0) {
        console.log(`[Cron] ${slug}: No RPC URLs found`)
        failed++
        continue
      }

      try {
        // Validate nodes with full testing
        const { nodes, archiveNodes } = await validateChainNodes(rpcUrls, expectedChainId)

        if (nodes.length > 0) {
          // Get whitelisted MEV nodes for this chain (if any)
          const mevNodes = MEV_NODES[slug] || []

          // Store in D1
          const icon = (chainEntry as { icon?: string }).icon
          await storeChainData(env.DB, slug, chainEntry.name, icon, expectedChainId, nodes, archiveNodes, mevNodes)
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
