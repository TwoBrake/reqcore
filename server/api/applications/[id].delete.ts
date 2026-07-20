import { and, eq, inArray } from 'drizzle-orm'
import {
  application,
  candidateConversation,
  candidateMessage,
  candidateMessageAttachment,
  comment,
  interview,
  propertyValue,
} from '../../database/schema'
import { applicationIdParamSchema } from '../../utils/schemas/application'
import { cancelCalendarEvent } from '../../utils/google-calendar'

/**
 * DELETE /api/applications/:id
 *
 * Permanently removes an application and its application-specific data. The
 * candidate record and candidate documents are intentionally left untouched.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['delete'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const existing = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Application not found' })
  }

  const applicationInterviews = await db.query.interview.findMany({
    where: and(eq(interview.applicationId, id), eq(interview.organizationId, orgId)),
    columns: {
      id: true,
      status: true,
      invitationSentAt: true,
      googleCalendarEventId: true,
      createdById: true,
    },
  })
  const activeInvitation = applicationInterviews.find(row =>
    row.invitationSentAt && row.status === 'scheduled',
  )
  if (activeInvitation) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cancel scheduled interviews before deleting this application',
    })
  }

  const conversations = await db.query.candidateConversation.findMany({
    where: and(
      eq(candidateConversation.applicationId, id),
      eq(candidateConversation.organizationId, orgId),
    ),
    columns: { id: true },
  })
  const conversationIds = conversations.map(row => row.id)
  const messages = conversationIds.length > 0
    ? await db.query.candidateMessage.findMany({
        where: and(
          inArray(candidateMessage.conversationId, conversationIds),
          eq(candidateMessage.organizationId, orgId),
        ),
        columns: { id: true },
      })
    : []
  const messageIds = messages.map(row => row.id)
  const attachments = messageIds.length > 0
    ? await db.query.candidateMessageAttachment.findMany({
        where: and(
          inArray(candidateMessageAttachment.messageId, messageIds),
          eq(candidateMessageAttachment.organizationId, orgId),
        ),
        columns: { storageKey: true },
      })
    : []

  for (const attachment of attachments) {
    try {
      await deleteFromS3(attachment.storageKey)
    }
    catch (error) {
      logWarn('application.attachment_delete_failed', {
        organization_id: orgId,
        application_id: id,
        storage_key: attachment.storageKey,
        error_message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(comment).where(and(
      eq(comment.organizationId, orgId),
      eq(comment.targetType, 'application'),
      eq(comment.targetId, id),
    ))
    await tx.delete(propertyValue).where(and(
      eq(propertyValue.organizationId, orgId),
      eq(propertyValue.entityType, 'application'),
      eq(propertyValue.entityId, id),
    ))

    const deleted = await tx.delete(application)
      .where(and(eq(application.id, id), eq(application.organizationId, orgId)))
      .returning({ id: application.id })
    if (deleted.length === 0) {
      throw createError({ statusCode: 404, statusMessage: 'Application not found' })
    }
  })

  for (const row of applicationInterviews) {
    if (!row.googleCalendarEventId) continue
    cancelCalendarEvent(row.createdById, row.googleCalendarEventId).catch((error) => {
      logError('calendar.cancel_event_on_application_delete_failed', {
        organization_id: orgId,
        application_id: id,
        event_id: row.googleCalendarEventId,
        error_message: error instanceof Error ? error.message : String(error),
      })
    })
  }

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'deleted',
    resourceType: 'application',
    resourceId: id,
  })

  setResponseStatus(event, 204)
  return null
})
