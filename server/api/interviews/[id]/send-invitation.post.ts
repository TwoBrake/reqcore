import { and, eq } from 'drizzle-orm'
import { interview } from '../../../database/schema'
import { interviewIdParamSchema } from '../../../utils/schemas/interview'
import { sendInterviewConversationMessage } from '../../../utils/interview-conversation'

/** Retry a failed proposal/update using the generated conversation message and ICS. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['update'] })
  assertEmailVerified(session.user)
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, interviewIdParamSchema.parse)

  const current = await db.query.interview.findFirst({
    where: and(eq(interview.id, id), eq(interview.organizationId, orgId)),
    columns: { id: true, status: true, invitationSentAt: true },
  })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Interview not found' })
  if (!['scheduled', 'cancelled'].includes(current.status)) {
    throw createError({ statusCode: 400, statusMessage: `Cannot send an invitation for a ${current.status} interview` })
  }

  const tier = await assertPlanFeature(orgId, 'candidateMessaging')
  const delivery = await sendInterviewConversationMessage({
    interviewId: id,
    organizationId: orgId,
    sender: session.user,
    tier,
    retry: true,
    bypassAllowance: !!current.invitationSentAt,
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'interview',
    resourceId: id,
    metadata: {
      action: delivery.messageStatus === 'sent' ? 'invitation_sent' : 'invitation_failed',
      messageId: delivery.messageId,
      errorCode: delivery.errorCode,
    },
  })

  return { success: delivery.messageStatus === 'sent', delivery }
})
