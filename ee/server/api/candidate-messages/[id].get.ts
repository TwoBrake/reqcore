import { and, asc, eq } from 'drizzle-orm'
import { candidateConversation } from '~~/server/database/schema'
import { candidateMessageIdParamSchema } from '../../utils/schemas/candidate-message'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['read'] })
  const orgId = session.session.activeOrganizationId
  await assertPlanFeature(orgId, 'candidateMessaging')
  const { id } = await getValidatedRouterParams(event, candidateMessageIdParamSchema.parse)

  const conversation = await db.query.candidateConversation.findFirst({
    where: and(
      eq(candidateConversation.id, id),
      eq(candidateConversation.organizationId, orgId),
    ),
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
        orderBy: (message, { asc }) => [asc(message.createdAt)],
        columns: {
          id: true,
          direction: true,
          status: true,
          fromEmail: true,
          toEmail: true,
          subject: true,
          bodyText: true,
          kind: true,
          interviewId: true,
          calendarAttachmentStatus: true,
          calendarAttachmentError: true,
          sentAt: true,
          deliveredAt: true,
          failedAt: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
        },
        with: {
          sentBy: { columns: { id: true, name: true, email: true } },
          attachments: {
            columns: { id: true, filename: true, mimeType: true, sizeBytes: true },
            orderBy: (attachment, { asc }) => [asc(attachment.createdAt)],
          },
        },
      },
    },
  })

  if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  return conversation
})
