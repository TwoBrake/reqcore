import { describe, it, expect } from 'vitest'
import {
  ACTIVE_ROLE_LIMITS,
  activeRoleLimitForTier,
  getBillingPlan,
  FREE_PLAN_ANALYSIS_LIMIT,
  FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
  tierHasFeature,
} from '../../shared/billing'

/**
 * Pure-layer coverage for the pricing-v5 limit rules:
 *  - active-role caps per tier (server/utils/billing/plan.ts reads these)
 *  - the free-plan AI run allowance (server/utils/ai/budget.ts reads this)
 */

describe('active-role limits', () => {
  it('matches the pricing-v5 caps for every tier', () => {
    expect(ACTIVE_ROLE_LIMITS.free).toBe(1)
    expect(ACTIVE_ROLE_LIMITS.grandfathered).toBe(8)
    expect(ACTIVE_ROLE_LIMITS.solo).toBe(2)
    expect(ACTIVE_ROLE_LIMITS.team).toBe(8)
    expect(ACTIVE_ROLE_LIMITS.scale).toBe(24)
    expect(ACTIVE_ROLE_LIMITS.agency).toBe(Number.POSITIVE_INFINITY)
  })

  it('keeps each paid plan card in sync with the limit table', () => {
    for (const id of ['solo', 'team', 'scale'] as const) {
      expect(getBillingPlan(id)!.activeRoleLimit).toBe(ACTIVE_ROLE_LIMITS[id])
    }
  })

  it('falls back to the free cap for unknown tiers', () => {
    expect(activeRoleLimitForTier('mystery')).toBe(ACTIVE_ROLE_LIMITS.free)
    expect(activeRoleLimitForTier('grandfathered')).toBe(8)
    expect(activeRoleLimitForTier('scale')).toBe(24)
    expect(activeRoleLimitForTier('agency')).toBe(Number.POSITIVE_INFINITY)
  })

  it('agency is unlimited (non-finite) so the gate short-circuits', () => {
    expect(Number.isFinite(activeRoleLimitForTier('agency'))).toBe(false)
    expect(Number.isFinite(activeRoleLimitForTier('scale'))).toBe(true)
  })
})

describe('candidate messaging entitlement', () => {
  it('keeps inbox access available on every tier', () => {
    expect(tierHasFeature('free', 'candidateMessaging')).toBe(true)
    expect(tierHasFeature('solo', 'candidateMessaging')).toBe(true)
    expect(tierHasFeature('team', 'candidateMessaging')).toBe(true)
    expect(tierHasFeature('scale', 'candidateMessaging')).toBe(true)
  })

  it('exposes a five-conversation Free allowance', () => {
    expect(FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT).toBe(5)
  })
})

describe('free-plan AI allowance', () => {
  it('exposes a positive, finite run limit', () => {
    expect(FREE_PLAN_ANALYSIS_LIMIT).toBeGreaterThan(0)
    expect(Number.isFinite(FREE_PLAN_ANALYSIS_LIMIT)).toBe(true)
  })

  it('gates only at/over the limit', () => {
    const atLimit = (runs: number) => runs >= FREE_PLAN_ANALYSIS_LIMIT
    expect(atLimit(FREE_PLAN_ANALYSIS_LIMIT - 1)).toBe(false)
    expect(atLimit(FREE_PLAN_ANALYSIS_LIMIT)).toBe(true)
    expect(atLimit(FREE_PLAN_ANALYSIS_LIMIT + 1)).toBe(true)
  })
})
