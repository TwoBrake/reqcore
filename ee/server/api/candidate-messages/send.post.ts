import { and, desc, eq, sql } from 'drizzle-orm'
import {
  application,
  candidateConversation,
  candidateMessage,
} from '~~/server/database/schema'
import { sendCandidateMessageEmail } from '~~/server/utils/email'
import { FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT } from '~~/shared/billing'
import {
  canSendIntoConversation,
  countStartedConversations,
} from '../../utils/candidate-message-allowance'
import {
  appendReference,
  candidateReplyAddress,
  normalizeEmailAddress,
  replySubject,
} from '../../utils/candidate-messaging'
import { requireCandidateMessagingConfig } from '../../utils/candidate-messaging-config'
import { sendCandidateMessageSchema } from '../../utils/schemas/candidate-message'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['create'] })
  const orgId = session.session.activeOrganizationId
  const tier = await assertPlanFeature(orgId, 'candidateMessaging')
  const { replyDomain } = requireCandidateMessagingConfig()
  const body = await readValidatedBody(event, sendCandidateMessageSchema.parse)

  const applicationRecord = await db.query.application.findFirst({
    where: and(eq(application.id, body.applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
    with: {
      candidate: { columns: { email: true, quarantinedAt: true } },
      job: { columns: { title: true } },
    },
  })
  if (!applicationRecord) throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  if (applicationRecord.candidate.quarantinedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this candidate before sending a message' })
  }

  let conversation = await db.query.candidateConversation.findFirst({
    where: and(
      eq(candidateConversation.applicationId, body.applicationId),
      eq(candidateConversation.organizationId, orgId),
    ),
  })
  if (!conversation) {
    await db.insert(candidateConversation).values({
      organizationId: orgId,
      applicationId: body.applicationId,
    }).onConflictDoNothing({ target: candidateConversation.applicationId })
    conversation = await db.query.candidateConversation.findFirst({
      where: and(
        eq(candidateConversation.applicationId, body.applicationId),
        eq(candidateConversation.organizationId, orgId),
      ),
    })
  }
  if (!conversation) throw createError({ statusCode: 500, statusMessage: 'Could not create conversation' })

  const existing = await db.query.candidateMessage.findFirst({
    where: and(eq(candidateMessage.id, body.requestId), eq(candidateMessage.organizationId, orgId)),
  })
  if (existing && existing.conversationId !== conversation.id) {
    throw createError({ statusCode: 409, statusMessage: 'Request ID has already been used' })
  }
  if (existing?.providerMessageId) return existing

  const latestMessage = await db.query.candidateMessage.findFirst({
    where: eq(candidateMessage.conversationId, conversation.id),
    orderBy: [desc(candidateMessage.createdAt)],
  })
  const latestInbound = await db.query.candidateMessage.findFirst({
    where: and(
      eq(candidateMessage.conversationId, conversation.id),
      eq(candidateMessage.direction, 'inbound'),
    ),
    orderBy: [desc(candidateMessage.createdAt)],
  })
  const subject = latestMessage ? replySubject(latestMessage.subject) : body.subject
  const references = appendReference(latestInbound?.references, latestInbound?.internetMessageId)
  const now = new Date()

  const alreadySent = await db.transaction(async (tx) => {
    // Serialize Free allowance reservations per organization so overlapping
    // sends cannot both claim the fifth and final conversation slot.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`candidate-message:${orgId}`}))`,
    )

    const [current] = await tx.select().from(candidateMessage).where(and(
      eq(candidateMessage.id, body.requestId),
      eq(candidateMessage.organizationId, orgId),
    )).limit(1)

    if (current && current.conversationId !== conversation.id) {
      throw createError({ statusCode: 409, statusMessage: 'Request ID has already been used' })
    }
    if (current?.providerMessageId) return current

    // Replies into a started conversation are unlimited; only opening a new
    // conversation consumes one of the Free slots.
    if (!(await canSendIntoConversation(orgId, conversation.id, tier, tx))) {
      const used = await countStartedConversations(orgId, tx)
      throw createError({
        statusCode: 402,
        statusMessage: `You've started all ${FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT} free candidate conversations. Upgrade to Solo to open more.`,
        data: {
          code: 'CANDIDATE_MESSAGE_LIMIT',
          tier,
          used,
          limit: FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT,
        },
      })
    }

    if (!current) {
      await tx.insert(candidateMessage).values({
        id: body.requestId,
        organizationId: orgId,
        conversationId: conversation.id,
        direction: 'outbound',
        status: 'queued',
        fromEmail: normalizeEmailAddress(env.RESEND_CANDIDATE_FROM_EMAIL),
        toEmail: normalizeEmailAddress(applicationRecord.candidate.email),
        subject,
        bodyText: body.body,
        inReplyTo: latestInbound?.internetMessageId,
        references,
        sentById: session.user.id,
      })
      await tx.update(candidateConversation).set({ lastMessageAt: now, updatedAt: now })
        .where(eq(candidateConversation.id, conversation.id))
    } else {
      await tx.update(candidateMessage).set({
        status: 'queued',
        errorCode: null,
        errorMessage: null,
        failedAt: null,
        updatedAt: now,
      }).where(eq(candidateMessage.id, current.id))
    }

    return null
  })

  if (alreadySent) return alreadySent

  try {
    const result = await sendCandidateMessageEmail({
      to: applicationRecord.candidate.email,
      subject,
      text: body.body,
      replyTo: candidateReplyAddress(conversation.replyToken, replyDomain),
      senderName: session.user.name || session.user.email,
      idempotencyKey: `candidate-message/${body.requestId}`,
      inReplyTo: latestInbound?.internetMessageId,
      references,
      organizationId: orgId,
      conversationId: conversation.id,
      messageId: body.requestId,
    })
    const sentAt = new Date()
    const [sent] = await db.update(candidateMessage).set({
      status: 'sent',
      fromEmail: normalizeEmailAddress(result.from),
      providerMessageId: result.id,
      sentAt,
      updatedAt: sentAt,
    }).where(and(eq(candidateMessage.id, body.requestId), eq(candidateMessage.organizationId, orgId))).returning()
    return sent
  }
  catch (error) {
    const failedAt = new Date()
    await db.update(candidateMessage).set({
      status: 'failed',
      failedAt,
      errorCode: 'send_failed',
      errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown send error',
      updatedAt: failedAt,
    }).where(and(eq(candidateMessage.id, body.requestId), eq(candidateMessage.organizationId, orgId)))
    logError('candidate_message.send_failed', {
      organization_id: orgId,
      conversation_id: conversation.id,
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw createError({ statusCode: 502, statusMessage: 'Message could not be sent. It is safe to retry.' })
  }
})
