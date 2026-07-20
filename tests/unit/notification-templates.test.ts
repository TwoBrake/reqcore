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

  it('includes the composite score when present and omits it when null', () => {
    const withScore = renderNotification('analysis_completed', {
      candidateName: 'Amir',
      jobTitle: 'PM',
      compositeScore: 87,
      applicationUrl: 'https://app.example.com/dashboard/applications/x',
    })
    expect(withScore!.html).toContain('87/100')

    const withoutScore = renderNotification('analysis_completed', {
      candidateName: 'Amir',
      jobTitle: 'PM',
      compositeScore: null,
      applicationUrl: 'https://app.example.com/dashboard/applications/x',
    })
    expect(withoutScore!.html).not.toContain('/100')
  })

  it('rolls several events into one digest email', () => {
    const digest = renderDigest({
      items: [
        { type: 'application_created', payload: { candidateName: 'A', jobTitle: 'Role 1' }, applicationUrl: 'https://x/1' },
        { type: 'candidate_replied', payload: { candidateName: 'B', jobTitle: 'Role 2', preview: 'Thanks' }, applicationUrl: 'https://x/2' },
      ],
      dashboardUrl: 'https://x/dashboard',
    })
    expect(digest!.subject).toContain('2 updates')
    expect(digest!.html).toContain('Role 1')
    expect(digest!.html).toContain('Role 2')
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
  })
})
