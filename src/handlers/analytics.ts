import { createRawJsonResponse } from '@/utils'

/**
 * Analytics endpoint - queries Analytics Engine for dashboard data
 * 
 * Endpoints:
 * - /analytics/overview - Overall stats (last 24h)
 * - /analytics/chains - Per-chain breakdown
 * - /analytics/methods - Most used methods
 * - /analytics/timeseries - Hourly data for graphs
 */

interface AnalyticsQuery {
  // Analytics Engine SQL query
  query: string
  timeRange?: string
}

// Analytics Engine SQL queries
// Filter: blob1 (chain) must be valid slug (alphanumeric/hyphen, no dots/slashes/encoded chars)
const VALID_CHAIN_FILTER = `AND blob1 LIKE '%' AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%' AND blob2 != 'unknown'`

const QUERIES = {
  // Overview stats for last 24h
  overview: `
    SELECT 
      SUM(_sample_interval * double1) as total_requests,
      AVG(double2) as avg_latency_ms,
      SUM(_sample_interval * double5) as cache_hits,
      SUM(_sample_interval * double6) as errors,
      SUM(_sample_interval * double7) as rate_limited
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
  `,

  // Stats per chain
  chainStats: `
    SELECT 
      blob1 as chain,
      SUM(_sample_interval * double1) as requests,
      AVG(double2) as avg_latency_ms,
      SUM(_sample_interval * double5) as cache_hits,
      SUM(_sample_interval * double6) as errors
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    GROUP BY blob1
    ORDER BY requests DESC
    LIMIT 50
  `,

  // Top methods (exclude 'unknown' methods - non-RPC requests)
  topMethods: `
    SELECT 
      blob1 as chain,
      blob2 as method,
      SUM(_sample_interval * double1) as count,
      AVG(double2) as avg_latency_ms
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    AND blob2 != 'unknown'
    GROUP BY blob1, blob2
    ORDER BY count DESC
    LIMIT 100
  `,

  // Hourly timeseries for last 24h
  hourlyTimeseries: `
    SELECT 
      toStartOfHour(timestamp) as hour,
      blob1 as chain,
      SUM(_sample_interval * double1) as requests,
      AVG(double2) as avg_latency_ms,
      SUM(_sample_interval * double5) as cache_hits,
      SUM(_sample_interval * double6) as errors
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    GROUP BY hour, blob1
    ORDER BY hour DESC
    LIMIT 500
  `,

  // Cache performance
  cachePerformance: `
    SELECT 
      blob1 as chain,
      blob3 as cache_status,
      SUM(_sample_interval * double1) as count
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    GROUP BY blob1, blob3
    ORDER BY count DESC
  `,

  // Error breakdown
  errorBreakdown: `
    SELECT 
      blob1 as chain,
      blob4 as status_code,
      blob5 as error_type,
      SUM(_sample_interval * double1) as count
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    AND double6 > 0
    GROUP BY blob1, blob4, blob5
    ORDER BY count DESC
    LIMIT 100
  `,

  // Methods per chain per hour (for detailed graphs)
  methodsPerHour: `
    SELECT 
      toStartOfHour(timestamp) as hour,
      blob1 as chain,
      blob2 as method,
      SUM(_sample_interval * double1) as count
    FROM nullrpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    AND blob2 != 'unknown'
    GROUP BY hour, blob1, blob2
    ORDER BY hour DESC, count DESC
    LIMIT 1000
  `
}

/**
 * Query Analytics Engine via Cloudflare API
 * Note: This requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars
 */
async function queryAnalyticsEngine(
  accountId: string,
  apiToken: string,
  query: string
): Promise<unknown[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'text/plain'
      },
      body: query
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Analytics Engine query failed: ${response.status} - ${errorText}`)
  }

  const result = await response.json() as { data?: unknown[]; meta?: unknown }
  
  // Return only the data array, strip meta
  return result.data || []
}

export async function handleAnalytics(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  // Check for required env vars (these should be set in wrangler.jsonc or secrets)
  const envAny = env as unknown as Record<string, string | undefined>
  const accountId = envAny.CLOUDFLARE_ACCOUNT_ID
  const apiToken = envAny.CLOUDFLARE_API_TOKEN

  if (!accountId || !apiToken) {
    return createRawJsonResponse(
      JSON.stringify({ 
        error: 'Analytics not configured',
        message: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required'
      }),
      500
    )
  }

  try {
    // Route to specific query
    if (path === '/analytics' || path === '/analytics/') {
      // Return all data for dashboard
      const [overview, chains, methods, timeseries, cache, errors] = await Promise.all([
        queryAnalyticsEngine(accountId, apiToken, QUERIES.overview),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.chainStats),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.topMethods),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.hourlyTimeseries),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.cachePerformance),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.errorBreakdown)
      ])

      return createRawJsonResponse(JSON.stringify({
        overview,
        chains,
        methods,
        timeseries,
        cachePerformance: cache,
        errors,
        generatedAt: new Date().toISOString()
      }))
    }

    if (path === '/analytics/overview') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.overview)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/chains') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.chainStats)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/methods') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.topMethods)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/timeseries') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.hourlyTimeseries)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/methods-hourly') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.methodsPerHour)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/cache') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.cachePerformance)
      return createRawJsonResponse(JSON.stringify(data))
    }

    if (path === '/analytics/errors') {
      const data = await queryAnalyticsEngine(accountId, apiToken, QUERIES.errorBreakdown)
      return createRawJsonResponse(JSON.stringify(data))
    }

    return createRawJsonResponse(
      JSON.stringify({ error: 'Unknown analytics endpoint' }),
      404
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return createRawJsonResponse(
      JSON.stringify({ error: 'Analytics query failed', message }),
      500
    )
  }
}
