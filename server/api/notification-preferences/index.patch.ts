import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { notificationPreference } from '../../database/schema'
import { DEFAULT_CHANNEL_MODE, NOTIFICATION_TYPES } from '~~/shared/notifications'

const bodySchema = z.object({
  preferences: z.array(z.object({
    type: z.enum(NOTIFICATION_TYPES),
    channelMode: z.enum(['instant', 'digest', 'off']),
  })).min(1),
})

/**
 * PATCH /api/notification-preferences
 * Upsert one or more of the current user's per-event preferences for the active
 * org, then return the full (defaults-filled) set — same shape as the GET route.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const enabled = await resolveFeatureFlagForEvent(event, 'notifications', {
    userId,
    organizationId: orgId,
  })
  if (!enabled) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const { preferences } = await readValidatedBody(event, bodySchema.parse)

  for (const pref of preferences) {
    await db.insert(notificationPreference)
      .values({ userId, organizationId: orgId, type: pref.type, channelMode: pref.channelMode })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.organizationId, notificationPreference.type],
        set: { channelMode: pref.channelMode, updatedAt: new Date() },
      })
  }

  const rows = await db.select({
    type: notificationPreference.type,
    channelMode: notificationPreference.channelMode,
  })
    .from(notificationPreference)
    .where(and(
      eq(notificationPreference.userId, userId),
      eq(notificationPreference.organizationId, orgId),
    ))
  const byType = new Map(rows.map(r => [r.type, r.channelMode]))

  return NOTIFICATION_TYPES.map(type => ({
    type,
    channelMode: byType.get(type) ?? DEFAULT_CHANNEL_MODE[type],
  }))
})
