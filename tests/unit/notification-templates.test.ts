import { describe, expect, it } from 'vitest'
import { renderNotification, renderDigest } from '../../server/utils/notifications/templates'

describe('notification templates', () => {
  it('renders an application_created email with subject, deep link, and details', () => {
    const rendered = renderNotification('application_created', {
      candidateName: 'Jane Doe',
      jobTitle: 'Staff Engineer',
      applicationUrl: 'https://app.example.com/dashboard/applications/abc',
    })
    expect(rendered).not.toBeNull()
    expect(rendered!.subject).toBe('New applicant for Staff Engineer')
    expect(rendered!.html).toContain('Jane Doe')
    expect(rendered!.html).toContain('https://app.example.com/dashboard/applications/abc')
    expect(rendered!.text).toContain('Jane Doe applied for Staff Engineer')
  })

  it('escapes untrusted candidate and job strings in the HTML', () => {
    const rendered = renderNotification('application_created', {
      candidateName: '<script>alert(1)</script>',
      jobTitle: 'Dev "><img src=x>',
      applicationUrl: 'https://app.example.com/dashboard/applications/abc',
    })
    expect(rendered!.html).not.toContain('<script>alert(1)</script>')
    expect(rendered!.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(rendered!.html).not.toContain('<img src=x>')
  })

  it.each([
    ['accepted', 'Interview accepted', 'Jane Doe accepted the interview'],
    ['declined', 'Interview declined', 'Jane Doe declined the interview'],
    ['tentative', 'New time requested', 'Jane Doe requested another time'],
  ] as const)('renders an %s interview response with a direct interview link', (response, heading, subject) => {
    const rendered = renderNotification('interview_response', {
      candidateName: 'Jane Doe',
      jobTitle: 'Staff Engineer',
      interviewTitle: 'Technical interview',
      response,
      interviewUrl: 'https://app.example.com/dashboard/interviews/interview-1',
    })

    expect(rendered).not.toBeNull()
    expect(rendered!.subject).toBe(subject)
    expect(rendered!.html).toContain(heading)
    expect(rendered!.html).toContain('Technical interview')
    expect(rendered!.html).toContain('https://app.example.com/dashboard/interviews/interview-1')
    expect(rendered!.text).toContain('Staff Engineer')
  })

  it('rolls several events into one digest email', () => {
    const digest = renderDigest({
      items: [
        { type: 'application_created', payload: { candidateName: 'A', jobTitle: 'Role 1' }, applicationUrl: 'https://x/1' },
        { type: 'candidate_replied', payload: { candidateName: 'B', jobTitle: 'Role 2', preview: 'Thanks' }, applicationUrl: 'https://x/2' },
        { type: 'interview_response', payload: { candidateName: 'C', jobTitle: 'Role 3', interviewTitle: 'Screening', response: 'accepted' }, applicationUrl: 'https://x/3' },
      ],
      dashboardUrl: 'https://x/dashboard',
    })
    expect(digest!.subject).toContain('3 updates')
    expect(digest!.html).toContain('Role 1')
    expect(digest!.html).toContain('Role 2')
    expect(digest!.html).toContain('Screening')
    expect(digest!.html).toContain('https://x/dashboard')
  })

  it('rejects malformed instant and digest payloads', () => {
    expect(renderNotification('application_created', {
      candidateName: 'Jane',
      applicationUrl: 'https://x/app',
    })).toBeNull()
    expect(renderDigest({
      items: [{
        type: 'candidate_replied',
        payload: { candidateName: 'Jane', jobTitle: 'Engineer' },
        applicationUrl: 'https://x/app',
      }],
      dashboardUrl: 'https://x/dashboard',
    })).toBeNull()
    expect(renderNotification('interview_response', {
      candidateName: 'Jane',
      jobTitle: 'Engineer',
      interviewTitle: 'Screening',
      response: 'pending',
      interviewUrl: 'https://x/interview',
    })).toBeNull()
  })
})
