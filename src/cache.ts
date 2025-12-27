// biome-ignore lint/suspicious/noExplicitAny: we use any for now
export async function calculateCacheKey(chain: string, body: any): Promise<string> {
  const bodyString = JSON.stringify(body)

  const encoder = new TextEncoder()

  const data = encoder.encode(bodyString)

  const hashBuffer = await crypto.subtle.digest('SHA-256', data)

  const hashArray = Array.from(new Uint8Array(hashBuffer))

  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  // Construct a fake URL for the cache key since Cache API requires a Request/URL
  // We include chain and hash to ensure uniqueness
  return `https://cache.null-rpc.internal/${chain}/${hashHex}`
}

// biome-ignore lint/suspicious/noExplicitAny: we don't check for params yet
export function getCacheTtl(method: string, params: any[]): number {
  switch (method) {
    // Live data (Short TTL)
    case 'eth_blockNumber':
    case 'eth_gasPrice':
    case 'eth_getBalance':
    case 'eth_call':
    case 'eth_estimateGas':
      return 1 // 1 second

    // Less volatile / Static (Long TTL)
    case 'eth_chainId':
    case 'net_version':
    case 'web3_clientVersion':
    case 'eth_getBlockByHash':
    case 'eth_getTransactionReceipt':
      return 900 // 15 minutes

    // Block by number: if 'latest' -> short, specific number -> long
    case 'eth_getBlockByNumber': {
      const blockTag = params[0]
      // Standard tags that change: latest, earliest, pending, safe, finalized
      if (['latest', 'earliest', 'pending', 'safe', 'finalized'].includes(blockTag)) {
        return 1
      }
      // Specific block number (hex string) -> Static
      return 900
    }

    default:
      return 0 // Do not cache by default
  }
}

export async function getCachedResponse(keyUrl: string): Promise<Response | null> {
  const cache = caches.default
  const response = await cache.match(keyUrl)

  if (!response) return null

  return response
}

export async function cacheResponse(
  keyUrl: string,
  response: Response,
  ttl: number,
  ctx: ExecutionContext
): Promise<void> {
  if (ttl <= 0) return

  // We need to clone the response to store it used
  const responseToCache = response.clone()

  // Cache API requires headers to set expiration
  const headers = new Headers(responseToCache.headers)
  headers.set('Cache-Control', `public, max-age=${ttl}`)
  // We might needed to remove some headers that prevent caching?

  const optimizedResponse = new Response(responseToCache.body, {
    headers,
    status: responseToCache.status,
    statusText: responseToCache.statusText
  })

  // Put into cache
  // We use ctx.waitUntil to not block the response
  ctx.waitUntil(caches.default.put(keyUrl, optimizedResponse))
}
