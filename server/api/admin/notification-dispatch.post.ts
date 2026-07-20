/**
 * POST /api/admin/notification-dispatch
 *
 * External cron and interactive admin entrypoint for the notification outbox
 * worker. Mirrors /api/admin/retention-cleanup: a valid `x-cron-secret` runs it
 * as a scheduled trigger, otherwise it requires an authenticated admin. Provides
 * a timer-suspend-safe way to drain the outbox if Railway pauses the in-process
 * Nitro cron.
 *
 * Pass `{ "digest": true }` to run the daily digest job instead of instant dispatch.
 */
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { runNotificationDispatch, runNotificationDigest } from '../../utils/notifications/dispatch'

const bodySchema = z.object({
  digest: z.boolean().optional().default(false),
  batchSize: z.number().int().min(1).max(500).optional(),
})

export default defineEventHandler(async (event) => {
  const cronSecret = getHeader(event, 'x-cron-secret')
  let source: 'cron_endpoint' | 'interactive' = 'interactive'

  if (cronSecret && env.CRON_SECRET) {
    const supplied = Buffer.from(cronSecret)
    const expected = Buffer.from(env.CRON_SECRET)
    const valid = supplied.length === expected.length && timingSafeEqual(supplied, expected)
    if (!valid) {
      throw createError({ statusCode: 403, statusMessage: 'Invalid cron secret' })
    }
    source = 'cron_endpoint'
  }
  else {
    // Reuse an existing high-trust permission — draining the queue is an admin op.
    await requirePermission(event, { organization: ['update'] })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  return body.digest
    ? runNotificationDigest({ source, batchSize: body.batchSize })
    : runNotificationDispatch({ source, batchSize: body.batchSize })
})
