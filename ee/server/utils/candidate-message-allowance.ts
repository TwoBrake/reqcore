import { and, count, eq, ne } from 'drizzle-orm'
import { candidateMessage } from '~~/server/database/schema'
import {
  FREE_PLAN_CANDIDATE_MESSAGE_LIMIT,
  type BillingTier,
} from '~~/shared/billing'

export interface CandidateMessageAllowance {
  tier: BillingTier
  used: number
  limit: number | null
  remaining: number | null
  canSend: boolean
}

export function candidateMessageAllowanceFromUsage(
  tier: BillingTier,
  used: number,
): CandidateMessageAllowance {
  if (tier !== 'free') {
    return { tier, used, limit: null, remaining: null, canSend: true }
  }

  const remaining = Math.max(0, FREE_PLAN_CANDIDATE_MESSAGE_LIMIT - used)
  return {
    tier,
    used,
    limit: FREE_PLAN_CANDIDATE_MESSAGE_LIMIT,
    remaining,
    canSend: remaining > 0,
  }
}

/**
 * Count outbound slots already consumed by an organization. Immediate provider
 * failures release their slot; inbound messages never enter this count.
 */
export async function getCandidateMessageAllowance(
  orgId: string,
  tier: BillingTier,
): Promise<CandidateMessageAllowance> {
  const [{ value: used } = { value: 0 }] = await db
    .select({ value: count() })
    .from(candidateMessage)
    .where(and(
      eq(candidateMessage.organizationId, orgId),
      eq(candidateMessage.direction, 'outbound'),
      ne(candidateMessage.status, 'failed'),
    ))

  return candidateMessageAllowanceFromUsage(tier, used)
}
