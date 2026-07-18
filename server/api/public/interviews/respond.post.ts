import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { application, candidateConversation, candidateMessage, interview } from '../../../database/schema'
import { normalizeEmailAddress, replySubject } from '../../../../ee/server/utils/candidate-messaging'
import { verifyInterviewToken } from '../../../utils/interview-token'

const respondBodySchema = z.object({
  token: z.string().min(1, 'Token is required'),
  action: z.enum(['accepted', 'declined', 'tentative']),
})

/**
 * POST /api/public/interviews/respond  { token: "xxx", action: "accepted" }
 *
 * Public endpoint for candidates to confirm their interview response.
 * Updates candidateResponse + candidateRespondedAt in the database.
 * No authentication required — the HMAC-signed token is the proof of authorization.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, respondBodySchema.parse)
  const token = body.token
  const action = body.action

  const payload = verifyInterviewToken(token, env.BETTER_AUTH_SECRET)
  if (!payload) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid or expired token' })
  }

  // Fetch the interview to verify it still exists and is in a respondable state
  const interviewRecord = await db.query.interview.findFirst({
    where: eq(interview.id, payload.id),
  })

  if (!interviewRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Interview not found' })
  }

  if (interviewRecord.status !== 'scheduled') {
    throw createError({
      statusCode: 400,
      statusMessage: `This interview has been ${interviewRecord.status} and can no longer be responded to.`,
    })
  }

  // Idempotency: if already responded with the same action, return early
  if (interviewRecord.candidateResponse === action) {
    return {
      success: true,
      interviewId: interviewRecord.id,
      response: interviewRecord.candidateResponse,
      respondedAt: interviewRecord.candidateRespondedAt,
    }
  }

  const app = await db.query.application.findFirst({
    where: eq(application.id, interviewRecord.applicationId),
    with: { candidate: { columns: { email: true } } },
  })
  const conversation = await db.query.candidateConversation.findFirst({
    where: and(
      eq(candidateConversation.applicationId, interviewRecord.applicationId),
      eq(candidateConversation.organizationId, interviewRecord.organizationId),
    ),
  })
  const latestMessage = conversation
    ? await db.query.candidateMessage.findFirst({
        where: eq(candidateMessage.conversationId, conversation.id),
        orderBy: [desc(candidateMessage.createdAt)],
      })
    : null

  const respondedAt = new Date()
  const responseLabel = action === 'accepted'
    ? 'Confirmed the interview'
    : action === 'tentative'
      ? 'Requested another time'
      : 'Declined the interview'

  const updated = await db.transaction(async (tx) => {
    // Serialize concurrent responses for this interview. Two flips arriving at
    // once must not both pass the change check below and double-insert a
    // response message (or double-count the unread badge).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`interview-response:${payload.id}`}))`)

    // Re-read under the lock — the pre-transaction idempotency check above is a
    // cheap fast path only and may be stale by the time we get here.
    const [current] = await tx.select({
      candidateResponse: interview.candidateResponse,
      candidateRespondedAt: interview.candidateRespondedAt,
    }).from(interview).where(eq(interview.id, payload.id)).limit(1)

    if (!current || current.candidateResponse === action) {
      return {
        id: payload.id,
        candidateResponse: current?.candidateResponse ?? action,
        candidateRespondedAt: current?.candidateRespondedAt ?? respondedAt,
      }
    }

    const [result] = await tx.update(interview)
      .set({ candidateResponse: action, candidateRespondedAt: respondedAt, updatedAt: respondedAt })
      .where(eq(interview.id, payload.id))
      .returning({
        id: interview.id,
        candidateResponse: interview.candidateResponse,
        candidateRespondedAt: interview.candidateRespondedAt,
      })

    if (conversation && app?.candidate) {
      // Append an inbound message only the first time the candidate enters this
      // state. Toggling back to a response they've already given still updates
      // the interview but adds no new message, so a token holder can't flood the
      // recruiter's inbox by alternating actions — response rows are bounded to
      // at most one per distinct response.
      const [seen] = await tx.select({ one: sql`1` })
        .from(candidateMessage)
        .where(and(
          eq(candidateMessage.conversationId, conversation.id),
          eq(candidateMessage.interviewId, interviewRecord.id),
          eq(candidateMessage.kind, 'interview_response'),
          eq(candidateMessage.bodyText, responseLabel),
        ))
        .limit(1)

      if (!seen) {
        await tx.insert(candidateMessage).values({
          organizationId: interviewRecord.organizationId,
          conversationId: conversation.id,
          direction: 'inbound',
          status: 'delivered',
          fromEmail: normalizeEmailAddress(app.candidate.email),
          toEmail: normalizeEmailAddress(env.RESEND_CANDIDATE_FROM_EMAIL),
          subject: latestMessage ? replySubject(latestMessage.subject) : `Interview response: ${interviewRecord.title}`,
          bodyText: responseLabel,
          kind: 'interview_response',
          interviewId: interviewRecord.id,
          calendarAttachmentStatus: 'not_applicable',
          deliveredAt: respondedAt,
          createdAt: respondedAt,
          updatedAt: respondedAt,
        })
        await tx.update(candidateConversation).set({
          unreadCount: sql`${candidateConversation.unreadCount} + 1`,
          lastMessageAt: respondedAt,
          updatedAt: respondedAt,
        }).where(eq(candidateConversation.id, conversation.id))
      }
    }
    return result
  })

  return {
    success: true,
    interviewId: updated?.id,
    response: updated?.candidateResponse,
    respondedAt: updated?.candidateRespondedAt,
  }
})
