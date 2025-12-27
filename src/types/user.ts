import type { PlanType } from './plans'

export interface UserStorageData {
  plan: PlanType
  usage: {
    currentMonthRequestCount: number
    lastResetTimestamp: number
  }
}
