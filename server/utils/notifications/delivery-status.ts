import type { WebhookEventPayload } from 'resend'
import { and, eq } from 'drizzle-orm'
import { emailSuppression, notificationOutbox } from '../../database/schema'

const NOTIFICATION_STATUS_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.failed',
  'email.complained',
] as const

export type NotificationStatusEvent = Extract<
  WebhookEventPayload,
  { type: (typeof NOTIFICATION_STATUS_EVENTS)[number] }
>

function statusError(event: NotificationStatusEvent): { code: string, message: string } | null {
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

function suppressionForEvent(event: NotificationStatusEvent): 'bounce' | 'complaint' | null {
  if (event.type === 'email.complained') return 'complaint'
  if (event.type === 'email.bounced') {
    const type = event.data.bounce.type?.toLowerCase() ?? ''
    if (type.includes('hard') || type.includes('permanent')) return 'bounce'
  }
  return null
}

export async function processNotificationStatusEvent(event: NotificationStatusEvent): Promise<void> {
  const eventAt = new Date(event.created_at)
  const outboxRow = await db.query.notificationOutbox.findFirst({
    where: eq(notificationOutbox.providerMessageId, event.data.email_id),
    columns: {
      id: true,
      organizationId: true,
      recipientUserId: true,
      recipientEmail: true,
      cadence: true,
      digestBucket: true,
    },
  })

  if (!outboxRow) return

  const identity = outboxRow.cadence === 'digest' && outboxRow.digestBucket
    ? and(
        eq(notificationOutbox.organizationId, outboxRow.organizationId),
        eq(notificationOutbox.recipientUserId, outboxRow.recipientUserId),
        eq(notificationOutbox.recipientEmail, outboxRow.recipientEmail),
        eq(notificationOutbox.digestBucket, outboxRow.digestBucket),
      )
    : eq(notificationOutbox.id, outboxRow.id)

  const isFailure = event.type === 'email.bounced'
    || event.type === 'email.failed'
    || event.type === 'email.complained'
  const error = statusError(event)
  await db.update(notificationOutbox).set({
    ...(isFailure ? { status: 'dead' as const, failedAt: eventAt } : {}),
    ...(error ? { lastError: `${error.code}: ${error.message}`.slice(0, 1000) } : {}),
    updatedAt: new Date(),
  }).where(identity)

  const suppression = suppressionForEvent(event)
  if (suppression) {
    await db.insert(emailSuppression)
      .values({ email: outboxRow.recipientEmail.trim().toLowerCase(), reason: suppression })
      .onConflictDoNothing()
  }
}
