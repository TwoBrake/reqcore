/**
 * Enqueue a recruiter notification event into the durable outbox.
 *
 * Modeled on `recordActivity` — it never throws, so a notification failure can
 * never break the primary write. Accepts an optional transaction so critical
 * events are enqueued atomically with the triggering write: if the tx rolls
 * back, the outbox rows roll back with it.
 *
 * Idempotency: each recipient row's `dedupeKey` is `<event key>:<userId>`, and
 * inserts use `onConflictDoNothing`, so re-running the same producer is a no-op.
 */
import { notificationOutbox } from '../../database/schema/app'
import type { NotificationType } from '~~/shared/notifications'
import { resolveRecipients, type NotificationDbClient } from './recipients'

const DIGEST_HOUR_UTC = 8

/** The next 08:00 UTC digest delivery date (YYYY-MM-DD). */
export function digestBucketFor(date: Date = new Date()): string {
  const cutoff = new Date(date)
  cutoff.setUTCHours(DIGEST_HOUR_UTC, 0, 0, 0)
  if (date >= cutoff) cutoff.setUTCDate(cutoff.getUTCDate() + 1)
  return cutoff.toISOString().slice(0, 10)
}

export function digestDeliveryAt(bucket: string): Date {
  return new Date(`${bucket}T${String(DIGEST_HOUR_UTC).padStart(2, '0')}:00:00.000Z`)
}

export async function enqueueNotification(params: {
  organizationId: string
  type: NotificationType
  /** Event-scoped idempotency prefix, e.g. `application_created:<applicationId>`. */
  dedupeKey: string
  payload: Record<string, unknown>
  tx?: NotificationDbClient
}): Promise<void> {
  const dbc = params.tx ?? db
  try {
    const recipients = await resolveRecipients(params.organizationId, params.type, dbc)
    if (recipients.length === 0) return

    const bucket = digestBucketFor()
    const rows = recipients.map(r => ({
      organizationId: params.organizationId,
      recipientUserId: r.userId,
      recipientEmail: r.email,
      type: params.type,
      cadence: r.cadence,
      dedupeKey: `${params.dedupeKey}:${r.userId}`,
      payload: params.payload,
      digestBucket: r.cadence === 'digest' ? bucket : null,
      nextAttemptAt: r.cadence === 'digest' ? digestDeliveryAt(bucket) : new Date(),
    }))

    await dbc.insert(notificationOutbox).values(rows)
      .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
  }
  catch (err) {
    if (params.tx) throw err
    // Enqueue must never break the primary operation.
    logWarn('notification.enqueue_failed', {
      organization_id: params.organizationId,
      type: params.type,
      dedupe_key: params.dedupeKey,
      error_message: err instanceof Error ? err.message : String(err),
    })
  }
}
