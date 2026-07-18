import { and, eq } from 'drizzle-orm'
import { interview, application, organization } from '../../database/schema'
import { createInterviewSchema } from '../../utils/schemas/interview'
import { APPLICATION_STATUS_TRANSITIONS } from '../../utils/schemas/application'
import { createCalendarEvent } from '../../utils/google-calendar'
import { tierHasFeature } from '../../../shared/billing'
import { sendInterviewConversationMessage } from '../../utils/interview-conversation'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { interview: ['create'] })
  assertEmailVerified(session.user)
  const orgId = session.session.activeOrganizationId

  // Free scheduling is limited by the existing tracked conversation allowance.
  const tier = await assertPlanFeature(orgId, 'candidateMessaging')

  const body = await readValidatedBody(event, createInterviewSchema.parse)

  // Calendar (Google) sync is a Team+ feature. An explicit opt-in from a tier
  // that can't use it is a hard 402; otherwise we just skip the sync silently.
  const canSyncCalendar = tierHasFeature(tier, 'calendar')
  if (body.calendarSync === true) assertTierFeature(tier, 'calendar')

  // Verify the application exists and belongs to this org
  const app = await db.query.application.findFirst({
    where: and(
      eq(application.id, body.applicationId),
      eq(application.organizationId, orgId),
    ),
    with: {
      candidate: { columns: { email: true, firstName: true, lastName: true, quarantinedAt: true } },
      job: { columns: { title: true } },
    },
  })

  if (!app) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Application not found',
    })
  }
  if (app.candidate.quarantinedAt) {
    throw createError({ statusCode: 409, statusMessage: 'Restore this candidate before scheduling an interview' })
  }

  const interviewTypeLabel = body.type === 'in_person'
    ? 'In-person interview'
    : `${body.type.charAt(0).toUpperCase()}${body.type.slice(1).replace('_', ' ')} interview`
  const title = body.title?.trim() || `${interviewTypeLabel} - ${app.job.title}`

  const [created] = await db.insert(interview).values({
    organizationId: orgId,
    applicationId: body.applicationId,
    title,
    type: body.type,
    scheduledAt: new Date(body.scheduledAt),
    duration: body.duration,
    location: body.location ?? null,
    notes: body.notes ?? null,
    personalNote: body.personalNote ?? null,
    interviewers: body.interviewers ?? null,
    timezone: body.timezone ?? 'UTC',
    createdById: session.user.id,
  }).returning()

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Failed to create interview' })

  // Scheduling an interview moves the candidate into the interview stage.
  // Done server-side so the transition is guaranteed once the interview
  // exists, regardless of how the client leaves the scheduling flow.
  if (app.status !== 'interview' && (APPLICATION_STATUS_TRANSITIONS[app.status] ?? []).includes('interview')) {
    await db.update(application)
      .set({ status: 'interview', updatedAt: new Date() })
      .where(and(eq(application.id, app.id), eq(application.organizationId, orgId)))

    recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: 'status_changed',
      resourceType: 'application',
      resourceId: app.id,
      metadata: { from: app.status, to: 'interview' },
    })

    trackEvent(event, session, 'application status_changed', {
      application_id: app.id,
      job_id: app.jobId,
      from_status: app.status,
      to_status: 'interview',
    })
  }

  // Sync to Google Calendar only when explicitly requested
  let calendarEventLink: string | null = null
  let calendarEventId: string | null = null

  if (body.calendarSync !== false && canSyncCalendar && app.candidate && app.job) {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, orgId),
      columns: { name: true },
    })

    const candidateName = `${app.candidate.firstName} ${app.candidate.lastName}`
    const calendarTitle = body.calendarEventTitle?.trim() || title
    const calendarDescription = body.calendarEventDescription?.trim() || [
      `Interview: ${title}`,
      `Position: ${app.job.title}`,
      `Candidate: ${candidateName}`,
      `Duration: ${body.duration} minutes`,
      ...(body.location ? [`Location: ${body.location}`] : []),
      ...(body.notes ? [`\nNotes: ${body.notes}`] : []),
      '',
      `Scheduled via ${org?.name || 'Reqcore'}`,
    ].join('\n')
    try {
      const result = await createCalendarEvent(session.user.id, {
        title: calendarTitle,
        description: calendarDescription,
        startTime: new Date(body.scheduledAt),
        durationMinutes: body.duration,
        timezone: body.timezone ?? 'UTC',
        location: body.location ?? null,
        // Candidate-facing delivery always stays in the Reqcore conversation.
        candidateEmail: null,
        candidateName,
        interviewerEmails: body.interviewers ?? [],
        sendUpdates: false,
      })

      if (result) {
        calendarEventId = result.id
        calendarEventLink = result.htmlLink
        await db.update(interview)
          .set({ googleCalendarEventId: result.id, googleCalendarEventLink: result.htmlLink })
          .where(eq(interview.id, created.id))
      }
    } catch (err) {
      logError('interview.calendar_sync_failed', {
        posthog_distinct_id: session.user.id,
        org_id: orgId,
        interview_id: created.id,
        error_message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const delivery = await sendInterviewConversationMessage({
    interviewId: created.id,
    organizationId: orgId,
    sender: session.user,
    tier,
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'interview',
    resourceId: created.id,
    metadata: {
      applicationId: body.applicationId,
      title,
      scheduledAt: body.scheduledAt,
    },
  })

  trackEvent(event, session, 'interview scheduled', {
    interview_id: created.id,
    application_id: body.applicationId,
    interview_type: body.type,
    duration_minutes: body.duration,
    has_calendar_sync: !!calendarEventId,
  })

  logApiRequest(event, session, 'interview.scheduled', {
    interview_id: created.id,
    application_id: body.applicationId,
    interview_type: body.type,
    duration_minutes: body.duration,
    has_calendar_sync: !!calendarEventId,
  })

  setResponseStatus(event, 201)
  return {
    ...created,
    ...(calendarEventId && { googleCalendarEventId: calendarEventId }),
    ...(calendarEventLink && { googleCalendarEventLink: calendarEventLink }),
    delivery,
  }
})
