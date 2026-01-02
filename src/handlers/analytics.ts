import { createRawJsonResponse } from '@/utils'

// Analytics Engine SQL queries

// Helper to get chain filter clause
const GetChainClause = (chain?: string | null) => (chain && chain !== 'all' ? `AND blob1 = '${chain}'` : '')

const QUERIES = {
  // Hourly timeseries
  hourlyTimeseries: (chain?: string | null) => `
    SELECT
      toStartOfHour(timestamp) as hour,
      blob1 as chain,
      SUM(_sample_interval * double1) as requests,
      AVG(double2) as avg_latency_ms,
      SUM(_sample_interval * double5) as cache_hits,
      SUM(_sample_interval * double6) as errors
    FROM null_rpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    ${GetChainClause(chain)}
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
    GROUP BY hour, blob1
    ORDER BY hour DESC
    LIMIT 500
  `,
  // Overview stats for last 24h
  overview: (chain?: string | null) => `
    SELECT
      SUM(_sample_interval * double1) as total_requests,
      AVG(double2) as avg_latency_ms,
      SUM(_sample_interval * double5) as cache_hits,
      SUM(_sample_interval * double6) as errors,
      SUM(_sample_interval * double7) as rate_limited
    FROM null_rpc_metrics
    WHERE timestamp > NOW() - INTERVAL '24' HOUR
    AND index1 = 'rpc_requests'
    ${GetChainClause(chain)}
    AND blob1 NOT LIKE '%.%' AND blob1 NOT LIKE '%/%'
  `
}

/**
 * Query Analytics Engine via Cloudflare API
 * Note: This requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars
 */
async function queryAnalyticsEngine(accountId: string, apiToken: string, query: string): Promise<unknown[]> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    body: query,
    headers: {
      // biome-ignore lint/style/useNamingConvention: required
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'text/plain'
    },
    method: 'POST'
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Analytics Engine query failed: ${response.status} - ${errorText}`)
  }

  const result = (await response.json()) as { data?: unknown[]; meta?: unknown }

  // Return only the data array, strip meta
  return result.data || []
}

export async function handleAnalytics(request: Request, env: Env): Promise<Response> {
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
    // Get optional chain filter from query params
    const chainFilter = url.searchParams.get('chain')

    // Route to specific query
    if (path === '/analytics' || path === '/analytics/') {
      console.log(`[Analytics] Filtering by chain: ${chainFilter || 'all'}`)

      // Return all data for dashboard
      const [overview, timeseries] = await Promise.all([
        queryAnalyticsEngine(accountId, apiToken, QUERIES.overview(chainFilter)),
        queryAnalyticsEngine(accountId, apiToken, QUERIES.hourlyTimeseries(chainFilter))
      ])

      return createRawJsonResponse(
        JSON.stringify({
          chainFilter: chainFilter || 'all',
          generatedAt: new Date().toISOString(),
          overview,
          timeseries
        })
      )
    }

    return createRawJsonResponse(JSON.stringify({ error: 'Unknown analytics endpoint' }), 404)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return createRawJsonResponse(JSON.stringify({ error: 'Analytics query failed', message }), 500)
  }
}
