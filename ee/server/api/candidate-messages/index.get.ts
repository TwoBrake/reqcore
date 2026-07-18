import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { application, candidateConversation } from '~~/server/database/schema'
import { getCandidateMessageAllowance } from '../../utils/candidate-message-allowance'
import { candidateInboxQuerySchema } from '../../utils/schemas/candidate-message'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['read'] })
  const orgId = session.session.activeOrganizationId
  const tier = await assertPlanFeature(orgId, 'candidateMessaging')

  const query = await getValidatedQuery(event, candidateInboxQuerySchema.parse)
  const where = and(
    eq(candidateConversation.organizationId, orgId),
    query.applicationId ? eq(candidateConversation.applicationId, query.applicationId) : undefined,
    query.jobId
      ? inArray(
          candidateConversation.applicationId,
          db.select({ id: application.id }).from(application).where(eq(application.jobId, query.jobId)),
        )
      : undefined,
    query.unread ? gt(candidateConversation.unreadCount, 0) : undefined,
  )

  const [rows, allowance] = await Promise.all([
    db.query.candidateConversation.findMany({
      where,
      columns: {
        id: true,
        applicationId: true,
        unreadCount: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        application: {
          columns: { id: true, status: true },
          with: {
            candidate: { columns: { id: true, firstName: true, lastName: true, email: true } },
            job: { columns: { id: true, title: true } },
          },
        },
        messages: {
          limit: 1,
          orderBy: (message, { desc }) => [desc(message.createdAt)],
          columns: {
            id: true,
            direction: true,
            status: true,
            subject: true,
            bodyText: true,
            kind: true,
            interviewId: true,
            createdAt: true,
          },
        },
      },
      orderBy: [desc(candidateConversation.lastMessageAt)],
      limit: query.limit,
    }),
    getCandidateMessageAllowance(orgId, tier),
  ])

  return { data: rows, allowance }
})
