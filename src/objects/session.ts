import { DurableObject } from 'cloudflare:workers'
import { PLANS, type PlanType } from '../types/plans'
import type { RateLimitResult } from '../types/rates'
import type { UserStorageData } from '../types/user'

export class UserSession extends DurableObject {
  private storage: DurableObjectStorage

  // In-memory state for token bucket algorithm (Rate Limiting)
  private tokens = 0
  private lastRefill: number = Date.now()

  // Cache for Monthly Usage to avoid reading from disk every request
  private cachedUsage: UserStorageData | null = null

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.storage = state.storage
  }

  async checkLimit(): Promise<RateLimitResult> {
    const data = await this.ensureUserData()
    const plan = PLANS[data.plan]
    const now = Date.now()

    // 1. Check Monthly Limit
    // Reset if new month
    if (this.isNewMonth(data.usage.lastResetTimestamp, now)) {
      data.usage.currentMonthRequestCount = 0
      data.usage.lastResetTimestamp = now
      // We accept that we might lose a few requests of precision during the flush
      this.ctx.waitUntil(this.storage.put('data', data))
    }

    if (data.usage.currentMonthRequestCount >= plan.requestsPerMonth) {
      return {
        allowed: false,
        reason: 'monthly_limit',
        remaining: 0
      }
    }

    // 2. Check Rate Limit (Token Bucket)
    this.refillTokens(plan.requestsPerSecond, now)

    if (this.tokens < 1) {
      return {
        allowed: false,
        reason: 'rate_limit',
        remaining: 0
      }
    }

    // 3. Consume
    this.tokens -= 1
    data.usage.currentMonthRequestCount += 1

    // Persist usage occasionally or on every request?
    // For "almost 0 latency", we might want to batch this,
    // but DO writes are fast (coalesced). Let's write for correctness.
    // Optimization: we could write every N requests or use `waitUntil`.
    // However, for strict limits, we should ideally write.
    // Given the request for "almost 0 latency", we will write asynchronously
    // but keep the latest in memory. This risks losing small counts on crash,
    // but preserves latency.
    this.cachedUsage = data // Update cache
    this.ctx.waitUntil(this.storage.put('data', data))

    return {
      allowed: true,
      remaining: plan.requestsPerMonth - data.usage.currentMonthRequestCount
    }
  }

  async setPlan(plan: PlanType): Promise<void> {
    const data = await this.ensureUserData()
    data.plan = plan
    this.cachedUsage = data
    await this.storage.put('data', data)
  }

  async getMetrics(): Promise<UserStorageData> {
    return this.ensureUserData()
  }

  // --- Helpers ---

  private async ensureUserData(): Promise<UserStorageData> {
    if (this.cachedUsage) return this.cachedUsage

    let data = await this.storage.get<UserStorageData>('data')
    if (!data) {
      data = {
        plan: 'hobbyist', // Default plan
        usage: {
          currentMonthRequestCount: 0,
          lastResetTimestamp: Date.now()
        }
      }
    }
    this.cachedUsage = data
    return data
  }

  private refillTokens(rps: number, now: number) {
    const elapsed = (now - this.lastRefill) / 1000
    if (elapsed <= 0) return

    const newTokens = elapsed * rps
    // Max burst: allow 2x RPS as burst capacity? Or just strictly RPS?
    // Let's allow 1 second worth of burst.
    const maxTokens = rps * 1.5

    this.tokens = Math.min(maxTokens, this.tokens + newTokens)
    this.lastRefill = now
  }

  private isNewMonth(lastTimestamp: number, now: number): boolean {
    const last = new Date(lastTimestamp)
    const current = new Date(now)
    return last.getMonth() !== current.getMonth() || last.getFullYear() !== current.getFullYear()
  }
}
