/**
 * Resolve which org members should receive a given notification event, honoring
 * per-recipient preferences and the email suppression list.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { member, user } from '../../database/schema/auth'
import { emailSuppression, notificationPreference } from '../../database/schema/app'
import {
  DEFAULT_CHANNEL_MODE,
  type NotificationCadence,
  type NotificationType,
} from '~~/shared/notifications'

/** Either the global db or an open transaction — both expose the query/select API we use. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type NotificationDbClient = typeof db | Tx

export interface NotificationRecipient {
  userId: string
  email: string
  cadence: NotificationCadence
}

/**
 * Return the members of `organizationId` who want `type` delivered (mode !== 'off'
 * after applying defaults), excluding any address on the suppression list.
 */
export async function resolveRecipients(
  organizationId: string,
  type: NotificationType,
  dbc: NotificationDbClient = db,
): Promise<NotificationRecipient[]> {
  const members = await dbc
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, organizationId))

  if (members.length === 0) return []

  const prefs = await dbc
    .select({ userId: notificationPreference.userId, channelMode: notificationPreference.channelMode })
    .from(notificationPreference)
    .where(and(
      eq(notificationPreference.organizationId, organizationId),
      eq(notificationPreference.type, type),
    ))
  const prefByUser = new Map(prefs.map(p => [p.userId, p.channelMode]))

  const emails = members.map(m => m.email.toLowerCase())
  const suppressed = await dbc
    .select({ email: emailSuppression.email })
    .from(emailSuppression)
    .where(inArray(sql<string>`lower(${emailSuppression.email})`, emails))
  const suppressedSet = new Set(suppressed.map(s => s.email.toLowerCase()))

  const recipients: NotificationRecipient[] = []
  for (const m of members) {
    if (suppressedSet.has(m.email.toLowerCase())) continue
    const mode = prefByUser.get(m.userId) ?? DEFAULT_CHANNEL_MODE[type]
    if (mode === 'off') continue
    recipients.push({ userId: m.userId, email: m.email, cadence: mode })
  }
  return recipients
}
