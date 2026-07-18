import { and, eq } from 'drizzle-orm'
import { interview } from '../../../database/schema'
import { interviewIdParamSchema, updateInterviewSchema } from '../../../utils/schemas/interview'
import { INTERVIEW_STATUS_TRANSITIONS } from '~~/shared/status-transitions'
import { updateCalendarEvent, cancelCalendarEvent } from '../../../utils/google-calendar'
import { sendInterviewConversationMessage } from '../../../utils/interview-conversation'
import {
  candidateFacingInterviewChanged,
  interviewNotificationIntent,
} from '../../../utils/interview-notification'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, interviewIdParamSchema.parse)
  const body = await readValidatedBody(event, updateInterviewSchema.parse)

  // Fetch current interview for validation
  const current = await db.query.interview.findFirst({
    where: and(eq(interview.id, id), eq(interview.organizationId, orgId)),
    columns: {
      id: true,
      status: true,
      title: true,
      type: true,
      scheduledAt: true,
      duration: true,
      location: true,
      interviewers: true,
      timezone: true,
      personalNote: true,
      invitationSentAt: true,
      googleCalendarEventId: true,
      createdById: true,
    },
    with: {
      application: {
        with: {
          candidate: { columns: { quarantinedAt: true } },
        },
      },
    },
  })

  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Interview not found' })
  }

  // Validate status transition
  if (body.status && body.status !== current.status) {
    const allowed = INTERVIEW_STATUS_TRANSITIONS[current.status] ?? []
    if (!allowed.includes(body.status)) {
      throw createError({
        statusCode: 422,
        statusMessage: `Cannot transition from "${current.status}" to "${body.status}"`,
      })
    }
  }

  const proposalFieldsChanged = candidateFacingInterviewChanged(current, body)
  const notificationIntent = interviewNotificationIntent({
    current,
    patch: body,
    candidateFacingChanged: proposalFieldsChanged,
    notifyCandidate: body.notifyCandidate,
  })
  if (notificationIntent) assertEmailVerified(session.user)
  const tier = notificationIntent
    ? await assertPlanFeature(orgId, 'candidateMessaging')
    : null
  if (notificationIntent && current.application.candidate.quarantinedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this candidate before sending an interview update' })
  }
  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (body.title !== undefined) updateData.title = body.title
  if (body.type !== undefined) updateData.type = body.type
  if (body.status !== undefined) updateData.status = body.status
  if (body.scheduledAt !== undefined) updateData.scheduledAt = new Date(body.scheduledAt)
  if (body.duration !== undefined) updateData.duration = body.duration
  if (body.location !== undefined) updateData.location = body.location
  if (body.notes !== undefined) updateData.notes = body.notes
  if (body.personalNote !== undefined) updateData.personalNote = body.personalNote
  if (body.interviewers !== undefined) updateData.interviewers = body.interviewers
  if (body.timezone !== undefined) updateData.timezone = body.timezone
  const returningToSchedule = body.status === 'scheduled' && current.status !== 'scheduled'
  if (current.invitationSentAt && (proposalFieldsChanged || returningToSchedule) && (body.status ?? current.status) === 'scheduled') {
    updateData.candidateResponse = 'pending'
    updateData.candidateRespondedAt = null
  }

  const [updated] = await db
    .update(interview)
    .set(updateData)
    .where(and(eq(interview.id, id), eq(interview.organizationId, orgId)))
    .returning()

  // Sync changes to Google Calendar (non-blocking)
  if (current.googleCalendarEventId) {
    const isCancelling = body.status === 'cancelled'

    if (isCancelling) {
      cancelCalendarEvent(current.createdById, current.googleCalendarEventId).catch(err => {
        logError('calendar.cancel_event_failed', {
          event_id: current.googleCalendarEventId,
          error_message: err instanceof Error ? err.message : String(err),
        })
      })
    }
    else {
      updateCalendarEvent(current.createdById, current.googleCalendarEventId, {
        ...(body.title ? { title: body.title } : {}),
        ...(body.scheduledAt ? {
          startTime: new Date(body.scheduledAt),
          durationMinutes: body.duration ?? updated?.duration ?? 60,
          timezone: body.timezone ?? current.timezone ?? 'UTC',
        } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.interviewers !== undefined ? { interviewerEmails: body.interviewers ?? [] } : {}),
      }).then(async (htmlLink) => {
        if (htmlLink) {
          await db.update(interview)
            .set({ googleCalendarEventLink: htmlLink })
            .where(and(eq(interview.id, id), eq(interview.organizationId, orgId)))
        }
      }).catch(err => {
        logError('calendar.update_event_failed', {
          event_id: current.googleCalendarEventId,
          error_message: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  const delivery = notificationIntent
    ? await sendInterviewConversationMessage({
        interviewId: id,
        organizationId: orgId,
        sender: session.user,
        tier: tier!,
        // Active interview updates remain deliverable after a Free limit is reached.
        bypassAllowance: notificationIntent !== 'proposal',
      })
    : null

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: body.status && body.status !== current.status ? 'status_changed' : 'updated',
    resourceType: 'interview',
    resourceId: id,
    metadata: {
      ...(body.status && body.status !== current.status
        ? { from: current.status, to: body.status }
        : {}),
      notificationIntent,
      notificationStatus: delivery?.messageStatus ?? 'not_required',
      messageId: delivery?.messageId ?? null,
    },
  })

  return {
    ...updated,
    delivery,
    notification: {
      intent: notificationIntent,
      attempted: !!delivery,
      status: delivery?.messageStatus ?? 'not_required',
      messageId: delivery?.messageId ?? null,
      reason: !current.invitationSentAt && body.status === 'cancelled'
        ? 'no_prior_invitation'
        : notificationIntent
          ? null
          : 'internal_status_only',
    },
  }
})
