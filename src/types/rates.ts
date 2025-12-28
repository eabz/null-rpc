export interface RateLimitResult {
  allowed: boolean
  reason?: 'monthly_limit' | 'rate_limit' | 'user_not_found'
  remaining: number
}
