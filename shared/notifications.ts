/**
 * Shared notification constants — single source of truth for the recruiter
 * notification engine's event types, delivery modes, and per-type defaults.
 *
 * Imported by both the server (recipient resolution, dispatch) and the client
 * (preferences UI) so the two never drift.
 */

/** The three v1 recruiter-facing events. */
export const NOTIFICATION_TYPES = [
  'candidate_replied',
  'application_created',
  'analysis_completed',
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
  analysis_completed: 'instant',
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
  analysis_completed: {
    label: 'AI scoring finished',
    description: 'An applicant was scored and is ready to review.',
  },
}

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value)
}
