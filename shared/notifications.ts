/**
 * Shared notification constants — single source of truth for the recruiter
 * notification engine's event types, delivery modes, and per-type defaults.
 *
 * Imported by both the server (recipient resolution, dispatch) and the client
 * (preferences UI) so the two never drift.
 */

/** Recruiter-facing events supported by the notification engine. */
export const NOTIFICATION_TYPES = [
  'candidate_replied',
  'application_created',
  'interview_response',
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

/** How a recipient wants a given event delivered. `off` disables it entirely. */
export type NotificationChannelMode = 'instant' | 'digest' | 'off'

/** Delivery cadence of an individual outbox row (never `off` — off rows are not enqueued). */
export type NotificationCadence = 'instant' | 'digest'

/**
 * Default delivery mode when a recipient has no explicit preference row.
 * New-applicant is batched by default (high volume); replies and finished
 * scoring are instant because they're the pull-back-in moments.
 */
export const DEFAULT_CHANNEL_MODE: Record<NotificationType, NotificationChannelMode> = {
  candidate_replied: 'instant',
  application_created: 'digest',
  interview_response: 'instant',
}

/** Delivery choices exposed and accepted for each event. */
export const NOTIFICATION_CHANNEL_MODES: Record<NotificationType, readonly NotificationChannelMode[]> = {
  candidate_replied: ['off', 'instant', 'digest'],
  application_created: ['off', 'digest'],
  interview_response: ['off', 'instant', 'digest'],
}

/** Human-readable copy for the preferences UI. */
export const NOTIFICATION_TYPE_META: Record<NotificationType, { label: string, description: string }> = {
  candidate_replied: {
    label: 'Candidate replied',
    description: 'A candidate answered one of your messages.',
  },
  application_created: {
    label: 'New applicant',
    description: 'Someone applied to one of your open roles.',
  },
  interview_response: {
    label: 'Interview response',
    description: 'A candidate accepts, declines, or requests another time for an interview.',
  },
}

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value)
}

export function isNotificationChannelModeAllowed(
  type: NotificationType,
  mode: NotificationChannelMode,
): boolean {
  return NOTIFICATION_CHANNEL_MODES[type].includes(mode)
}

export function normalizeNotificationChannelMode(
  type: NotificationType,
  mode: NotificationChannelMode,
): NotificationChannelMode {
  return isNotificationChannelModeAllowed(type, mode) ? mode : DEFAULT_CHANNEL_MODE[type]
}
