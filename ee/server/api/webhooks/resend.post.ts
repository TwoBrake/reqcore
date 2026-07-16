import type { WebhookEventPayload } from 'resend'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import {
  candidateConversation,
  candidateMessage,
  candidateMessageWebhookEvent,
} from '~~/server/database/schema'
import { getResendClient, getResendReceivingClient } from '~~/server/utils/email'
import { restoreCandidateForEngagement } from '~~/server/utils/candidate-retention'
import {
  findReplyToken,
  inboundTextContent,
  normalizeEmailAddress,
  parseReferences,
} from '../../utils/candidate-messaging'
import { requireCandidateMessagingConfig } from '../../utils/candidate-messaging-config'

const STATUS_BY_EVENT = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.failed': 'failed',
  'email.complained': 'complained',
} as const

export default defineEventHandler(async (event) => {
  const { replyDomain, webhookSecret } = requireCandidateMessagingConfig()
  const payload = await readRawBody(event, 'utf8')
  const webhookId = getHeader(event, 'svix-id')
  const timestamp = getHeader(event, 'svix-timestamp')
  const signature = getHeader(event, 'svix-signature')
  if (!payload || !webhookId || !timestamp || !signature || !webhookSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Missing webhook payload or signature headers' })
  }

  const resend = getResendClient()
  if (!resend) throw createError({ statusCode: 503, statusMessage: 'Resend is not configured' })

  let verified: WebhookEventPayload
  try {
    verified = resend.webhooks.verify({
      payload,
      headers: { id: webhookId, timestamp, signature },
      webhookSecret,
    })
  }
  catch {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  const providerMessageId = 'email_id' in verified.data ? verified.data.email_id : null
  const occurredAt = new Date(verified.created_at)
  await db.insert(candidateMessageWebhookEvent).values({
    id: webhookId,
    type: verified.type,
    providerMessageId,
    occurredAt,
  }).onConflictDoNothing({ target: candidateMessageWebhookEvent.id })

  const existingEvent = await db.query.candidateMessageWebhookEvent.findFirst({
    where: eq(candidateMessageWebhookEvent.id, webhookId),
    columns: { processedAt: true },
  })
  if (existingEvent?.processedAt) return { received: true, duplicate: true }

  try {
    if (verified.type === 'email.received') {
      await processInboundMessage(verified, replyDomain)
    } else if (verified.type in STATUS_BY_EVENT) {
      await processStatusEvent(verified as StatusWebhookEvent)
    }

    await db.update(candidateMessageWebhookEvent).set({ processedAt: new Date(), lastError: null })
      .where(eq(candidateMessageWebhookEvent.id, webhookId))
    return { received: true }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.update(candidateMessageWebhookEvent).set({ lastError: message.slice(0, 1000) })
      .where(eq(candidateMessageWebhookEvent.id, webhookId))
    logError('candidate_message.webhook_failed', {
      webhook_id: webhookId,
      event_type: verified.type,
      error_message: message,
    })
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})

type StatusWebhookEvent = Extract<WebhookEventPayload, { type: keyof typeof STATUS_BY_EVENT }>

async function processStatusEvent(event: StatusWebhookEvent): Promise<void> {
  const status = STATUS_BY_EVENT[event.type]
  const eventAt = new Date(event.created_at)
  const taggedMessageId = event.data.tags?.message
  const identity = taggedMessageId
    ? or(eq(candidateMessage.providerMessageId, event.data.email_id), eq(candidateMessage.id, taggedMessageId))
    : eq(candidateMessage.providerMessageId, event.data.email_id)
  const error = statusError(event)

  await db.update(candidateMessage).set({
    status,
    providerMessageId: event.data.email_id,
    providerStatusAt: eventAt,
    ...(status === 'sent' ? { sentAt: eventAt } : {}),
    ...(status === 'delivered' ? { deliveredAt: eventAt, errorCode: null, errorMessage: null } : {}),
    ...(['bounced', 'failed', 'complained'].includes(status) ? { failedAt: eventAt } : {}),
    ...(error ? { errorCode: error.code, errorMessage: error.message.slice(0, 1000) } : {}),
    updatedAt: new Date(),
  }).where(and(
    identity,
    or(isNull(candidateMessage.providerStatusAt), lte(candidateMessage.providerStatusAt, eventAt)),
  ))
}

function statusError(event: StatusWebhookEvent): { code: string, message: string } | null {
  if (event.type === 'email.bounced') {
    return { code: event.data.bounce.type, message: event.data.bounce.message }
  }
  if (event.type === 'email.failed') {
    return { code: 'failed', message: event.data.failed.reason }
  }
  if (event.type === 'email.complained') {
    return { code: 'complained', message: 'The recipient marked this message as spam' }
  }
  return null
}

async function processInboundMessage(
  event: Extract<WebhookEventPayload, { type: 'email.received' }>,
  replyDomain: string,
): Promise<void> {
  const token = findReplyToken(event.data.to, replyDomain)
  if (!token) {
    logWarn('candidate_message.inbound_unroutable', { provider_message_id: event.data.email_id })
    return
  }

  const conversation = await db.query.candidateConversation.findFirst({
    where: eq(candidateConversation.replyToken, token),
    with: {
      application: {
        with: { candidate: { columns: { email: true } } },
      },
    },
  })
  if (!conversation) {
    logWarn('candidate_message.inbound_unknown_token', { provider_message_id: event.data.email_id })
    return
  }

  const fromEmail = normalizeEmailAddress(event.data.from)
  if (fromEmail !== normalizeEmailAddress(conversation.application.candidate.email)) {
    logWarn('candidate_message.inbound_sender_mismatch', {
      organization_id: conversation.organizationId,
      conversation_id: conversation.id,
    })
    return
  }

  const resend = getResendReceivingClient()
  if (!resend) throw new Error('Resend Receiving is not configured')
  const { data, error } = await resend.emails.receiving.get(event.data.email_id)
  if (error || !data) throw new Error(error?.message ?? 'Inbound email content was unavailable')

  await restoreCandidateForEngagement(
    conversation.organizationId,
    conversation.application.candidateId,
    'candidate_message',
  )

  const header = (name: string) => {
    const entry = Object.entries(data.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())
    return entry?.[1]
  }
  const createdAt = new Date(data.created_at)
  const [inserted] = await db.insert(candidateMessage).values({
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: 'inbound',
    status: 'delivered',
    fromEmail,
    toEmail: normalizeEmailAddress(data.to[0] ?? event.data.to[0] ?? ''),
    subject: data.subject || event.data.subject || '(No subject)',
    bodyText: inboundTextContent(data.text, data.html),
    providerMessageId: data.id,
    internetMessageId: data.message_id,
    inReplyTo: header('in-reply-to'),
    references: parseReferences(header('references')),
    providerStatusAt: createdAt,
    sentAt: createdAt,
    deliveredAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  }).onConflictDoNothing().returning({ id: candidateMessage.id })

  if (inserted) {
    await db.update(candidateConversation).set({
      unreadCount: sql`${candidateConversation.unreadCount} + 1`,
      lastMessageAt: createdAt,
      updatedAt: new Date(),
    }).where(eq(candidateConversation.id, conversation.id))
  }
}
