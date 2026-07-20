import type { NotificationDbClient } from './recipients'
import { enqueueNotification } from './enqueue'

export type RecruiterInterviewResponse = 'accepted' | 'declined' | 'tentative'

/** Enqueue one bounded recruiter alert for each distinct candidate RSVP state. */
export async function enqueueInterviewResponseNotification(params: {
  organizationId: string
  interviewId: string
  candidateName: string
  jobTitle: string
  interviewTitle: string
  response: RecruiterInterviewResponse
  tx?: NotificationDbClient
}): Promise<void> {
  await enqueueNotification({
    organizationId: params.organizationId,
    type: 'interview_response',
    dedupeKey: `interview_response:${params.interviewId}:${params.response}`,
    payload: {
      interviewId: params.interviewId,
      candidateName: params.candidateName,
      jobTitle: params.jobTitle,
      interviewTitle: params.interviewTitle,
      response: params.response,
    },
    tx: params.tx,
  })
}
