export interface RateLimitResult {
  allowed: boolean
  reason?: 'monthly_limit' | 'rate_limit'
  remaining: number
}
