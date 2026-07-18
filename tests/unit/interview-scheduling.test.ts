import { describe, expect, it } from 'vitest'
import { buildICalendarAttachment, generateCancellationICS, generateInterviewICS } from '../../server/utils/ical'
import { buildInterviewConversationBody } from '../../server/utils/interview-conversation'
import { buildResponseUrl, verifyInterviewToken } from '../../server/utils/interview-token'
import {
  candidateFacingInterviewChanged,
  interviewNotificationIntent,
} from '../../server/utils/interview-notification'

const event = {
  interviewId: '2bc613d0-2198-4a8e-ac90-848bc661c6e3',
  summary: 'Technical interview',
  description: 'Interview details',
  startTime: new Date('2026-08-03T13:00:00.000Z'),
  durationMinutes: 60,
  location: 'https://meet.example.com/interview',
  organizerName: 'Recruiter Name',
  organizerEmail: 'recruiting@example.com',
  attendeeEmail: 'candidate@example.com',
  attendeeName: 'Candidate Name',
}

describe('interview conversation scheduling', () => {
  it('builds one signed response URL without choosing an action', () => {
    const responseUrl = buildResponseUrl(
      'https://reqcore.com',
      event.interviewId,
      'test-secret',
    )
    const url = new URL(responseUrl)
    const token = url.searchParams.get('token')

    expect(url.pathname).toBe('/interview/respond')
    expect([...url.searchParams.keys()]).toEqual(['token'])
    expect(token).toBeTruthy()
    expect(verifyInterviewToken(token!, 'test-secret')).toMatchObject({
      id: event.interviewId,
      purpose: 'interview_response',
    })
    expect(verifyInterviewToken(token!, 'wrong-secret')).toBeNull()
    expect(verifyInterviewToken(`${token!.split('.')[0]}.${'z'.repeat(64)}`, 'test-secret')).toBeNull()
  })

  it('keeps a stable ICS UID and increments sequence for reschedules', () => {
    const initial = generateInterviewICS({ ...event, sequence: 0 })
    const rescheduled = generateInterviewICS({
      ...event,
      startTime: new Date('2026-08-04T14:00:00.000Z'),
      sequence: 1,
    })

    expect(initial).toContain(`UID:interview-${event.interviewId}@reqcore.com`)
    expect(rescheduled).toContain(`UID:interview-${event.interviewId}@reqcore.com`)
    expect(initial).toContain('SEQUENCE:0')
    expect(initial).toContain('RSVP=FALSE')
    expect(initial).not.toContain('RSVP=TRUE')
    expect(rescheduled).toContain('SEQUENCE:1')
    expect(rescheduled).toContain('METHOD:REQUEST')
  })

  it('builds a calendar attachment Resend can deliver as an iTIP request', () => {
    const ics = generateInterviewICS({ ...event, sequence: 0 })
    const attachment = buildICalendarAttachment(ics, 'REQUEST')

    expect(attachment).toEqual({
      filename: 'interview.ics',
      content: Buffer.from(ics, 'utf8').toString('base64'),
      contentType: 'text/calendar; charset=utf-8; method=REQUEST',
    })
    expect(Buffer.from(attachment.content, 'base64').toString('utf8')).toBe(ics)
  })

  it('uses the same UID for cancellation updates', () => {
    const cancellation = generateCancellationICS({ ...event, sequence: 1 })
    const attachment = buildICalendarAttachment(cancellation, 'CANCEL')

    expect(cancellation).toContain('METHOD:CANCEL')
    expect(cancellation).toContain(`UID:interview-${event.interviewId}@reqcore.com`)
    expect(cancellation).toContain('SEQUENCE:2')
    expect(cancellation).toContain('STATUS:CANCELLED')
    expect(attachment.contentType).toContain('method=CANCEL')
  })

  it('uses a button prompt instead of embedding response URLs in the message body', () => {
    const body = buildInterviewConversationBody({
      kind: 'interview_proposal',
      candidateFirstName: 'Avery',
      title: 'Technical interview',
      type: 'video',
      date: 'Monday, August 3, 2026',
      time: '3:00 PM GMT+2',
      duration: 60,
      location: 'https://meet.example.com/interview',
      interviewers: ['recruiter@example.com'],
      personalNote: 'Looking forward to meeting you.',
    })

    expect(body).toContain('Use the response button in this email. The calendar event is for scheduling.')
    expect(body).not.toContain('/interview/respond')
    expect(body).toContain('Looking forward to meeting you.')
  })
})

describe('interview lifecycle notification intent', () => {
  const current = {
    title: 'Technical interview',
    type: 'video',
    status: 'scheduled',
    scheduledAt: new Date('2026-08-03T13:00:00.000Z'),
    duration: 60,
    location: 'https://meet.example.com/interview',
    interviewers: ['recruiter@example.com'],
    timezone: 'Europe/Oslo',
    personalNote: null,
    invitationSentAt: new Date('2026-07-20T10:00:00.000Z'),
  }

  it('does not treat resubmitted unchanged fields as a candidate update', () => {
    const patch = {
      title: current.title,
      type: current.type,
      scheduledAt: current.scheduledAt.toISOString(),
      duration: current.duration,
      location: current.location,
      interviewers: [...current.interviewers],
      timezone: current.timezone,
      personalNote: current.personalNote,
    }

    const changed = candidateFacingInterviewChanged(current, patch)
    expect(changed).toBe(false)
    expect(interviewNotificationIntent({ current, patch, candidateFacingChanged: changed })).toBeNull()
  })

  it('sends updates only for actual candidate-facing changes to scheduled interviews', () => {
    const patch = { scheduledAt: '2026-08-04T14:00:00.000Z' }
    const changed = candidateFacingInterviewChanged(current, patch)

    expect(changed).toBe(true)
    expect(interviewNotificationIntent({ current, patch, candidateFacingChanged: changed })).toBe('update')
  })

  it('always notifies on an explicit reschedule, including when the proposal was never sent', () => {
    const patch = {
      scheduledAt: '2026-08-04T14:00:00.000Z',
      status: 'scheduled',
    }

    expect(interviewNotificationIntent({
      current,
      patch,
      candidateFacingChanged: true,
      notifyCandidate: true,
    })).toBe('update')
    expect(interviewNotificationIntent({
      current: { ...current, invitationSentAt: null },
      patch,
      candidateFacingChanged: false,
      notifyCandidate: true,
    })).toBe('proposal')
  })

  it('treats cancellation as candidate-facing only after a proposal was sent', () => {
    const patch = { status: 'cancelled' }
    expect(interviewNotificationIntent({ current, patch, candidateFacingChanged: false })).toBe('cancellation')
    expect(interviewNotificationIntent({
      current: { ...current, invitationSentAt: null },
      patch,
      candidateFacingChanged: false,
    })).toBeNull()
  })

  it('sends a calendar update when a cancelled interview returns to scheduled', () => {
    const cancelled = { ...current, status: 'cancelled' }
    const patch = { status: 'scheduled' }

    expect(interviewNotificationIntent({
      current: cancelled,
      patch,
      candidateFacingChanged: false,
    })).toBe('update')
  })

  it.each(['completed', 'no_show'] as const)('keeps %s internal even when legacy forms resubmit details', (status) => {
    const patch = { status, title: 'Updated title' }
    const changed = candidateFacingInterviewChanged(current, patch)

    expect(changed).toBe(true)
    expect(interviewNotificationIntent({ current, patch, candidateFacingChanged: changed })).toBeNull()
  })
})
