import { and, eq, gte, sql } from 'drizzle-orm'
import { candidateMessage } from '../database/schema'
import { OUTBOUND_LIMITS, OUTBOUND_LIMIT_WINDOW_MS } from '~~/shared/abuse-limits'

/**
 * Abuse guard shared by the two outbound-email choke points — free-form
 * candidate messages and interview invitations. Both write outbound rows to
 * `candidate_message`, so one per-org rolling-hour cap bounds total mail
 * relayed through that channel regardless of which feature triggered it.
 *
 * Throws 429 when the organization has already created the maximum outbound
 * messages in the trailing window. This is independent of plan/business limits;
 * it exists purely to stop a hijacked or throwaway account from turning the
 * candidate email channel into a spam relay.
 */
export async function assertOutboundMessageLimit(organizationId: string): Promise<void> {
  const windowStart = new Date(Date.now() - OUTBOUND_LIMIT_WINDOW_MS)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(candidateMessage)
    .where(and(
      eq(candidateMessage.organizationId, organizationId),
      eq(candidateMessage.direction, 'outbound'),
      gte(candidateMessage.createdAt, windowStart),
    ))
  if ((row?.count ?? 0) >= OUTBOUND_LIMITS.outboundMessagesPerHour) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many messages sent in the past hour. Please try again later.',
    })
  }
}
