/**
 * Smart Caching for Ethereum RPC Methods
 *
 * Cache Strategy:
 * - LONG (900s/15min): Immutable/static data (chain ID, finalized blocks, tx receipts)
 * - MEDIUM (60s): Semi-stable data (code at specific block, proofs)
 * - SHORT (3s): Volatile but cacheable (current block, gas prices, balances)
 * - NONE (0): Never cache (nonces, pending tx, filters, mutations)
 *
 * Parameter-aware: Many methods change behavior based on block tag (latest vs specific)
 */

// Block tags that represent moving targets (not cacheable long-term)
const VOLATILE_BLOCK_TAGS = ['latest', 'earliest', 'pending', 'safe', 'finalized']

// Helper to check if block number is a specific (immutable) block
function isSpecificBlock(tag: unknown): boolean {
  if (typeof tag !== 'string') return false
  // Hex block number like "0x10d4f" - must start with 0x and NOT be a named tag
  return tag.startsWith('0x') && !VOLATILE_BLOCK_TAGS.includes(tag.toLowerCase())
}

/**
 * Determine cache TTL based on RPC method and parameters.
 * Returns 0 for methods that should never be cached.
 */
// biome-ignore lint/suspicious/noExplicitAny: params can be any array
export function getCacheTtl(method: string, params: any[]): number {
  switch (method) {
    // ═══════════════════════════════════════════════════════════════════════════
    // STATIC / IMMUTABLE DATA - Long TTL (15 minutes)
    // These values never change for a given chain/input
    // ═══════════════════════════════════════════════════════════════════════════
    case 'eth_chainId':
    case 'net_version':
    case 'web3_clientVersion':
      return 900

    // Transaction data by hash is immutable once confirmed
    case 'eth_getTransactionByHash':
    case 'eth_getRawTransactionByHash':
    case 'eth_getTransactionReceipt':
      return 900

    // Block data by hash is immutable
    case 'eth_getBlockByHash':
    case 'eth_getBlockReceipts': // Block hash version
    case 'eth_getBlockTransactionCountByHash':
    case 'eth_getUncleCountByBlockHash':
    case 'eth_getTransactionByBlockHashAndIndex':
      return 900

    // web3_sha3 is a pure function (deterministic hash)
    case 'web3_sha3':
      return 900

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCK-TAG DEPENDENT - Check if using specific block number
    // ═══════════════════════════════════════════════════════════════════════════

    // Block by number: specific block = long, latest/pending = short
    case 'eth_getBlockByNumber': {
      const blockTag = params[0]
      return isSpecificBlock(blockTag) ? 900 : 3
    }

    // Tx count in block: specific block = long, latest = short
    case 'eth_getBlockTransactionCountByNumber':
    case 'eth_getUncleCountByBlockNumber':
    case 'eth_getTransactionByBlockNumberAndIndex': {
      const blockTag = params[0]
      return isSpecificBlock(blockTag) ? 900 : 3
    }

    // Balance/code/storage depend on block tag
    case 'eth_getBalance':
    case 'eth_getCode':
    case 'eth_getStorageAt':
    case 'eth_getProof': {
      // Last param is usually blockTag
      const blockTag = params[params.length - 1]
      return isSpecificBlock(blockTag) ? 300 : 3 // 5 min for specific, 3s for latest
    }

    // eth_call depends heavily on block tag
    case 'eth_call': {
      const blockTag = params[1] // Second param is block tag
      return isSpecificBlock(blockTag) ? 300 : 3
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VOLATILE DATA - Short TTL (3 seconds)
    // Changes frequently but still benefits from brief caching
    // ═══════════════════════════════════════════════════════════════════════════
    case 'eth_blockNumber':
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas':
    case 'eth_feeHistory':
    case 'eth_blobBaseFee':
      return 3

    // Gas estimation varies but we can cache briefly
    case 'eth_estimateGas':
      return 3

    // Syncing status is relatively stable during sync
    case 'eth_syncing':
      return 5

    // Mining/hashrate rarely change
    case 'eth_mining':
    case 'eth_hashrate':
      return 10

    // Net status is stable
    case 'net_listening':
    case 'net_peerCount':
      return 10

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGS - Special handling: immutable for specific block ranges
    // ═══════════════════════════════════════════════════════════════════════════
    case 'eth_getLogs': {
      const filter = params[0]
      if (!filter || typeof filter !== 'object') return 0

      const { fromBlock, toBlock } = filter as { fromBlock?: string; toBlock?: string }

      // If both bounds are specific blocks, logs are immutable
      if (isSpecificBlock(fromBlock) && isSpecificBlock(toBlock)) {
        return 300 // 5 minutes
      }
      // If toBlock is latest/pending, can't cache long
      return 3
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // NEVER CACHE - State-changing or non-deterministic
    // ═══════════════════════════════════════════════════════════════════════════

    // Nonce is critical for tx ordering - NEVER cache
    case 'eth_getTransactionCount':
      return 0

    // Account list is local state
    case 'eth_accounts':
      return 0

    // Filter operations are stateful
    case 'eth_newFilter':
    case 'eth_newBlockFilter':
    case 'eth_newPendingTransactionFilter':
    case 'eth_getFilterChanges':
    case 'eth_getFilterLogs':
    case 'eth_uninstallFilter':
      return 0

    // Subscription operations
    case 'eth_subscribe':
    case 'eth_unsubscribe':
      return 0

    // Transaction sending/signing
    case 'eth_sendRawTransaction':
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'eth_sign':
      return 0

    // Txpool is highly dynamic
    case 'txpool_status':
    case 'txpool_content':
    case 'txpool_inspect':
    case 'txpool_contentFrom':
      return 0

    // Debug/trace methods - expensive and specific
    case 'debug_traceTransaction':
    case 'debug_traceBlockByHash':
    case 'debug_traceBlockByNumber':
    case 'debug_getBadBlocks':
    case 'trace_block':
    case 'trace_transaction':
    case 'trace_call':
      // Could cache traces of finalized blocks, but usually called once
      return 0

    // Simulation - parameters are complex and unique
    case 'eth_simulateV1':
    case 'eth_callMany':
      return 0

    default:
      // Unknown methods: don't cache by default for safety
      return 0
  }
}

/**
 * Generate a unique cache key from chain and request body.
 * Uses SHA-256 hash of the full request for uniqueness.
 */
// biome-ignore lint/suspicious/noExplicitAny: body structure varies
export async function calculateCacheKey(chain: string, body: any): Promise<string> {
  // Normalize body for consistent hashing
  // We only care about method and params, not id or jsonrpc version
  const normalizedBody = {
    method: body.method,
    params: body.params || []
  }

  const bodyString = JSON.stringify(normalizedBody)
  const encoder = new TextEncoder()
  const data = encoder.encode(bodyString)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  // Use a fake URL format for Cloudflare Cache API
  return `https://cache.null-rpc.internal/${chain}/${hashHex}`
}

/**
 * Retrieve a cached response if available.
 */
export async function getCachedResponse(keyUrl: string): Promise<Response | null> {
  const cache = caches.default
  const response = await cache.match(keyUrl)
  return response || null
}

/**
 * Store a response in cache with the specified TTL.
 * Uses ctx.waitUntil to not block the response.
 */
export async function cacheResponse(
  keyUrl: string,
  response: Response,
  ttl: number,
  ctx: ExecutionContext
): Promise<void> {
  if (ttl <= 0) return

  const responseToCache = response.clone()

  // Set cache headers for TTL
  const headers = new Headers(responseToCache.headers)
  headers.set('Cache-Control', `public, max-age=${ttl}`)
  // Remove any headers that might prevent caching
  headers.delete('Set-Cookie')

  const optimizedResponse = new Response(responseToCache.body, {
    headers,
    status: responseToCache.status,
    statusText: responseToCache.statusText
  })

  // Put into cache asynchronously
  ctx.waitUntil(caches.default.put(keyUrl, optimizedResponse))
}

/**
 * Get a human-readable cache category for a method (for debugging/logging)
 */
export function getCacheCategory(method: string): 'static' | 'volatile' | 'dynamic' | 'never' {
  const ttl = getCacheTtl(method, [])
  if (ttl >= 300) return 'static'
  if (ttl >= 3) return 'volatile'
  if (ttl > 0) return 'dynamic'
  return 'never'
}
