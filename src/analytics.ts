/**
 * Analytics Engine Integration for NullRPC
 *
 * Tracks comprehensive request metrics for monitoring and dashboards.
 * Uses Cloudflare Analytics Engine for time-series data storage.
 *
 * PRIVACY POLICY: We intentionally DO NOT track:
 * - IP addresses
 * - Geographic data (country, region, colo)
 * - Any personally identifiable information
 *
 * Data Structure:
 * - Blobs (strings): chain, method, cacheStatus, statusCode, errorType
 * - Doubles (numbers): latencyMs, requestCount, requestSize, responseSize, cacheHit
 * - Indexes (string): dataset identifier for querying
 */

export interface AnalyticsData {
  // Request identification (non-personal)
  chain: string
  method: string

  // User context (our data, not user's personal data)
  userType: 'public' | 'authenticated'
  userToken?: string // Optional: for per-user analytics

  // Cache metrics
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'NONE'

  // Response metrics
  statusCode: number
  latencyMs: number

  // Size metrics (optional, when available)
  requestSize?: number
  responseSize?: number

  // Error tracking (generic types only, no user context)
  errorType?: string
}

/**
 * Track a request to Analytics Engine.
 * Uses ctx.waitUntil to avoid blocking the response.
 *
 * Privacy-focused: Tracks our contextual data (userType, token),
 * but NO geographic or external user-identifiable data (IP, country, etc).
 */
export function trackRequest(env: Env, ctx: ExecutionContext, data: AnalyticsData): void {
  // Only track if Analytics Engine is available
  if (!env.ANALYTICS) return

  try {
    // Analytics Engine data point
    // Blobs: string dimensions for filtering/grouping (max 20)
    // Doubles: numeric values for aggregation (max 20)
    // Indexes: dataset name for querying (max 1)
    ctx.waitUntil(
      Promise.resolve(
        env.ANALYTICS.writeDataPoint({
          blobs: [
            data.chain, // blob1: Chain identifier (eth, bsc, etc)
            data.method || 'unknown', // blob2: RPC method name
            data.cacheStatus, // blob3: Cache status
            data.userType, // blob4: public or authenticated
            data.userToken || '', // blob5: User token for per-user analytics
            String(data.statusCode), // blob6: HTTP status code
            data.errorType || '' // blob7: Error type if any
          ],
          doubles: [
            1, // double1: Request count (always 1, for summing)
            data.latencyMs, // double2: Latency in milliseconds
            data.requestSize || 0, // double3: Request body size in bytes
            data.responseSize || 0, // double4: Response body size in bytes
            data.cacheStatus === 'HIT' ? 1 : 0, // double5: Cache hit (1) or miss (0)
            data.statusCode >= 400 ? 1 : 0, // double6: Error count (4xx/5xx)
            data.statusCode === 429 ? 1 : 0 // double7: Rate limited count
          ],
          indexes: ['rpc_requests'] // Dataset identifier
        })
      )
    )
  } catch (_) {
    // Silently fail - analytics should never break the request
  }
}

/**
 * Calculate request/response sizes when possible
 */
export function getContentLength(headers: Headers): number {
  const length = headers.get('content-length')
  return length ? Number.parseInt(length, 10) : 0
}

/**
 * Public stats response structure
 * Only includes aggregate, non-sensitive data
 */
export interface PublicStats {
  totalRequests: number
  cacheHitRate: number
  avgLatencyMs: number
  requestsByChain: Record<string, number>
  requestsByMethod: Record<string, number>
  uptimePercent: number
}

/**
 * Note: Querying Analytics Engine requires the GraphQL API
 * which needs to be called from a separate backend or scheduled worker.
 *
 * Example GraphQL query for stats:
 *
 * query {
 *   viewer {
 *     accounts(filter: { accountTag: "YOUR_ACCOUNT_ID" }) {
 *       rpcRequests: analyticsEngineAdaptiveGroups(
 *         filter: {
 *           datetime_gt: "2025-12-27T00:00:00Z"
 *           index: "rpc_requests"
 *         }
 *         limit: 10000
 *       ) {
 *         sum { double1 }  // Total requests
 *         avg { double2 }  // Avg latency
 *         dimensions { blob1 }  // By chain
 *       }
 *     }
 *   }
 * }
 */
