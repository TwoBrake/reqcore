import { and, eq } from 'drizzle-orm'
import { notificationPreference } from '../../database/schema'
import { DEFAULT_CHANNEL_MODE, NOTIFICATION_TYPES } from '~~/shared/notifications'
import { isDemoAccountEmail } from '../../utils/demoOrg'

/**
 * GET /api/notification-preferences
 * Returns the current user's per-event notification preferences for the active
 * org, with unset events filled in from the sensible defaults.
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

  if (isDemoAccountEmail(session.user.email)) {
    return NOTIFICATION_TYPES.map(type => ({ type, channelMode: 'off' as const }))
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
