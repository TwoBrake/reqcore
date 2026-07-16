import { and, eq } from 'drizzle-orm'
import { candidateConversation } from '~~/server/database/schema'
import { candidateMessageIdParamSchema } from '../../../utils/schemas/candidate-message'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['update'] })
  const orgId = session.session.activeOrganizationId
  await assertPlanFeature(orgId, 'candidateMessaging')
  const { id } = await getValidatedRouterParams(event, candidateMessageIdParamSchema.parse)

  const [updated] = await db.update(candidateConversation)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(and(
      eq(candidateConversation.id, id),
      eq(candidateConversation.organizationId, orgId),
    ))
    .returning({ id: candidateConversation.id })

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  return { success: true }
})
