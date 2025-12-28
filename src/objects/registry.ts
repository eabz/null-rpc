import { DurableObject } from 'cloudflare:workers'
import { PLANS, type PlanType } from '../types/plans'
import type { RateLimitResult } from '../types/rates'

interface UserRecord {
  token: string
  plan: PlanType
  created_at: number
  current_month_requests: number
  month_reset_at: number
  address: string
}

// In-memory state for active users (Token Bucket)
interface ActiveUserState {
  tokens: number
  lastRefill: number
  record: UserRecord
  dirty: boolean
}

export class UserRegistry extends DurableObject {
  private sql: SqlStorage

  // Cache active users in memory to avoid SQL reads on every request
  // and to hold the high-frequency token bucket state
  private activeUsers = new Map<string, ActiveUserState>()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.sql = state.storage.sql

    // Initialize Schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        token TEXT PRIMARY KEY,
        plan TEXT DEFAULT 'hobbyist',
        created_at INTEGER NOT NULL,
        
        -- Rate Limiting & Usage
        current_month_requests INTEGER DEFAULT 0,
        month_reset_at INTEGER NOT NULL,
        
        -- Metadata
        address TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_plan ON users(plan);
      CREATE INDEX IF NOT EXISTS idx_address ON users(address);
    `)
  }

  /**
   * Main entry point for rate limiting
   */
  async checkLimit(token: string): Promise<RateLimitResult> {
    const user = this.ensureUserLoaded(token)

    // If user doesn't exist, strictly deny
    if (!user) {
      return { allowed: false, reason: 'user_not_found', remaining: 0 }
    }

    const plan = PLANS[user.record.plan]
    const now = Date.now()

    // 1. Check Monthly Reset
    if (this.isNewMonth(user.record.month_reset_at, now)) {
      user.record.current_month_requests = 0
      user.record.month_reset_at = now
      user.dirty = true
    }

    // 2. Check Monthly Quota
    if (user.record.current_month_requests >= plan.requestsPerMonth) {
      if (user.dirty) this.flushUser(user)
      return { allowed: false, reason: 'monthly_limit', remaining: 0 }
    }

    // 3. Token Bucket Check
    this.refillTokens(user, plan.requestsPerSecond, now)

    if (user.tokens < 1) {
      if (user.dirty) this.flushUser(user)
      return { allowed: false, reason: 'rate_limit', remaining: 0 }
    }

    // 4. Consume & Success
    user.tokens -= 1
    user.record.current_month_requests += 1
    user.dirty = true

    // Optimistic flush: save usage to SQL asynchronously
    // In a high-load scenario, we might want to debounce this
    this.ctx.waitUntil(this.flushUser(user))

    return {
      allowed: true,
      remaining: plan.requestsPerMonth - user.record.current_month_requests
    }
  }

  // --- Internals ---

  private ensureUserLoaded(token: string): ActiveUserState | null {
    let active = this.activeUsers.get(token)
    if (active) return active

    // Try load from SQL
    const results = this.sql.exec('SELECT * FROM users WHERE token = ?', token)
    let record = Array.from(results)[0] as unknown as UserRecord | undefined

    // -------------------------------------------------------------------------
    // Auto-Seed for Load Testing (Dev/Test Helper)
    // -------------------------------------------------------------------------
    if (!record && token.startsWith('user_')) {
      const planMap: Record<string, PlanType> = {
        user_business: 'business',
        user_enterprise: 'enterprise',
        user_hobbyist: 'hobbyist',
        user_scaling: 'scaling'
      }

      if (planMap[token]) {
        // Auto-create test user
        const now = Date.now()
        const plan = planMap[token]
        // Use a dummy address for auto-created test users
        const address = `0x_auto_${plan}`

        this.sql.exec(
          `INSERT INTO users (token, plan, created_at, current_month_requests, month_reset_at, address)
           VALUES (?, ?, ?, 0, ?, ?)`,
          token,
          plan,
          now,
          now,
          address
        )

        // Fetch again
        const results = this.sql.exec('SELECT * FROM users WHERE token = ?', token)
        record = Array.from(results)[0] as unknown as UserRecord | undefined
      }
    }

    if (!record) {
      return null
    }

    active = {
      dirty: false,
      lastRefill: Date.now(),
      record,
      tokens: PLANS[record.plan].requestsPerSecond
    }

    this.activeUsers.set(token, active)
    return active
  }

  private refillTokens(user: ActiveUserState, rps: number, now: number) {
    const elapsed = (now - user.lastRefill) / 1000
    if (elapsed <= 0) return

    const newTokens = elapsed * rps
    // Max burst: 1.5x RPS
    const maxTokens = rps * 1.5

    user.tokens = Math.min(maxTokens, user.tokens + newTokens)
    user.lastRefill = now
  }

  private isNewMonth(lastTimestamp: number, now: number): boolean {
    const last = new Date(lastTimestamp)
    const current = new Date(now)
    return last.getMonth() !== current.getMonth() || last.getFullYear() !== current.getFullYear()
  }

  private async flushUser(user: ActiveUserState) {
    if (!user.dirty) return

    this.sql.exec(
      `
      UPDATE users 
      SET current_month_requests = ?, month_reset_at = ?, plan = ?
      WHERE token = ?
    `,
      user.record.current_month_requests,
      user.record.month_reset_at,
      user.record.plan,
      user.record.token
    )

    user.dirty = false
  }
}
