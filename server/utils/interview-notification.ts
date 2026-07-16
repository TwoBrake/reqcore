export const CANDIDATE_FACING_INTERVIEW_FIELDS = [
  'title',
  'type',
  'scheduledAt',
  'duration',
  'location',
  'interviewers',
  'timezone',
  'personalNote',
] as const

type CandidateFacingField = typeof CANDIDATE_FACING_INTERVIEW_FIELDS[number]

export type InterviewNotificationIntent = 'proposal' | 'update' | 'cancellation' | null

type StoredInterview = Record<CandidateFacingField, unknown> & {
  status: string
  invitationSentAt: Date | null
}

function comparableValue(field: CandidateFacingField, value: unknown): unknown {
  if (field === 'scheduledAt') {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'string') return new Date(value).getTime()
  }
  if (field === 'interviewers') return JSON.stringify(value ?? null)
  return value ?? null
}

export function candidateFacingInterviewChanged(
  current: StoredInterview,
  patch: Record<string, unknown>,
): boolean {
  return CANDIDATE_FACING_INTERVIEW_FIELDS.some((field) => {
    if (!(field in patch)) return false
    return comparableValue(field, current[field]) !== comparableValue(field, patch[field])
  })
}

export function interviewNotificationIntent(params: {
  current: StoredInterview
  patch: Record<string, unknown>
  candidateFacingChanged: boolean
  notifyCandidate?: boolean
}): InterviewNotificationIntent {
  const finalStatus = typeof params.patch.status === 'string'
    ? params.patch.status
    : params.current.status

  if (finalStatus === 'scheduled' && params.notifyCandidate) {
    return params.current.invitationSentAt ? 'update' : 'proposal'
  }

  if (!params.current.invitationSentAt) return null

  if (finalStatus === 'cancelled' && params.current.status !== 'cancelled') {
    return 'cancellation'
  }

  const isReturningToSchedule = finalStatus === 'scheduled' && params.current.status !== 'scheduled'
  if (finalStatus === 'scheduled' && (params.candidateFacingChanged || isReturningToSchedule)) {
    return 'update'
  }

  return null
}
