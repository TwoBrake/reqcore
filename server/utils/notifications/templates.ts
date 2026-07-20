/**
 * Recruiter notification email templates.
 *
 * `renderNotificationLayout` is the single shared HTML shell (header + card +
 * footer) that the auth/invitation emails in `email.ts` also reuse — extracting
 * it here pays down the verbatim duplication those three builders used to carry.
 *
 * Each event has one content builder returning `{ subject, html, text }`, and
 * `renderNotification` dispatches by type. All untrusted candidate/job strings
 * flow through `escapeHtml` before reaching the HTML.
 */
import { z } from 'zod'
import type { NotificationType } from '~~/shared/notifications'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Shared responsive email shell. `bodyHtml` is trusted, pre-built markup;
 * callers are responsible for escaping any untrusted values they interpolate.
 */
export function renderNotificationLayout(params: {
  title: string
  heading: string
  bodyHtml: string
  cta?: { label: string, url: string }
  /** Small muted paragraph rendered below the CTA (already-escaped/plain text). */
  note?: string
  footer?: string
}): string {
  const { title, heading, bodyHtml, cta, note } = params
  const footer = params.footer ?? 'Sent by Reqcore &mdash; Open-source applicant tracking'

  const noteHtml = note
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#71717a;">${escapeHtml(note)}</p>`
    : ''

  const ctaHtml = cta
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(cta.url)}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:12px 32px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:8px;line-height:1;">
                      ${escapeHtml(cta.label)}
                    </a>
                  </td>
                </tr>
              </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #f4f4f5;">
              <h1 style="margin:0;font-size:20px;font-weight:600;color:#09090b;">Reqcore</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#09090b;">${escapeHtml(heading)}</h2>
              ${bodyHtml}
              ${ctaHtml}
              ${noteHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;text-align:center;border-top:1px solid #f4f4f5;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─────────────────────────────────────────────
// Per-event payloads + content builders
// ─────────────────────────────────────────────

export interface ApplicationCreatedPayload {
  candidateName: string
  jobTitle: string
  applicationUrl: string
}

export interface AnalysisCompletedPayload {
  candidateName: string
  jobTitle: string
  /** Composite 0–100 score, or null when the run produced none. */
  compositeScore: number | null
  applicationUrl: string
}

export interface CandidateRepliedPayload {
  candidateName: string
  jobTitle: string
  /** Short preview of the reply, already trimmed by the producer. */
  preview: string
  applicationUrl: string
}

export interface NotificationPayloads {
  application_created: ApplicationCreatedPayload
  analysis_completed: AnalysisCompletedPayload
  candidate_replied: CandidateRepliedPayload
}

const basePayloadSchema = z.object({
  candidateName: z.string().min(1),
  jobTitle: z.string().min(1),
  applicationUrl: z.string().url(),
})

const payloadSchemas = {
  application_created: basePayloadSchema,
  analysis_completed: basePayloadSchema.extend({
    compositeScore: z.number().finite().min(0).max(100).nullable(),
  }),
  candidate_replied: basePayloadSchema.extend({ preview: z.string() }),
} as const

function parsePayload<T extends NotificationType>(
  type: T,
  payload: Record<string, unknown>,
): NotificationPayloads[T] | null {
  const result = payloadSchemas[type].safeParse(payload)
  return result.success ? result.data as NotificationPayloads[T] : null
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">${html}</p>`
}

function buildApplicationCreated(p: ApplicationCreatedPayload): RenderedEmail {
  const subject = `New applicant for ${p.jobTitle}`
  return {
    subject,
    html: renderNotificationLayout({
      title: subject,
      heading: 'New applicant',
      bodyHtml:
        paragraph(`<strong>${escapeHtml(p.candidateName)}</strong> applied for <strong>${escapeHtml(p.jobTitle)}</strong>.`)
        + paragraph('Open the application to review their profile.'),
      cta: { label: 'View application', url: p.applicationUrl },
    }),
    text: [
      'New applicant',
      '',
      `${p.candidateName} applied for ${p.jobTitle}.`,
      '',
      `View the application: ${p.applicationUrl}`,
      '',
      '— Reqcore',
    ].join('\n'),
  }
}

function buildAnalysisCompleted(p: AnalysisCompletedPayload): RenderedEmail {
  const scoreLabel = p.compositeScore != null ? `${p.compositeScore}/100` : 'ready'
  const subject = `AI scoring finished for ${p.candidateName}`
  const scoreLine = p.compositeScore != null
    ? paragraph(`Composite score: <strong>${escapeHtml(scoreLabel)}</strong>.`)
    : ''
  return {
    subject,
    html: renderNotificationLayout({
      title: subject,
      heading: 'AI scoring finished',
      bodyHtml:
        paragraph(`<strong>${escapeHtml(p.candidateName)}</strong> was scored for <strong>${escapeHtml(p.jobTitle)}</strong>.`)
        + scoreLine
        + paragraph('Open the application to see the breakdown and shortlist.'),
      cta: { label: 'Review scoring', url: p.applicationUrl },
    }),
    text: [
      'AI scoring finished',
      '',
      `${p.candidateName} was scored for ${p.jobTitle}.`,
      ...(p.compositeScore != null ? [`Composite score: ${scoreLabel}.`] : []),
      '',
      `Review the scoring: ${p.applicationUrl}`,
      '',
      '— Reqcore',
    ].join('\n'),
  }
}

function buildCandidateReplied(p: CandidateRepliedPayload): RenderedEmail {
  const subject = `${p.candidateName} replied`
  const previewHtml = p.preview
    ? `<div style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #e4e4e7;background:#fafafa;font-size:14px;line-height:1.6;color:#52525b;white-space:pre-wrap;">${escapeHtml(p.preview)}</div>`
    : ''
  return {
    subject,
    html: renderNotificationLayout({
      title: subject,
      heading: 'New reply',
      bodyHtml:
        paragraph(`<strong>${escapeHtml(p.candidateName)}</strong> replied about <strong>${escapeHtml(p.jobTitle)}</strong>.`)
        + previewHtml
        + paragraph('Open the conversation to respond.'),
      cta: { label: 'Open conversation', url: p.applicationUrl },
    }),
    text: [
      'New reply',
      '',
      `${p.candidateName} replied about ${p.jobTitle}.`,
      ...(p.preview ? ['', p.preview] : []),
      '',
      `Open the conversation: ${p.applicationUrl}`,
      '',
      '— Reqcore',
    ].join('\n'),
  }
}

/**
 * Render an instant notification email for one outbox row. Returns null when the
 * payload doesn't match the event's expected shape (defensive — a bad row is
 * skipped, not retried forever).
 */
export function renderNotification(
  type: NotificationType,
  payload: Record<string, unknown>,
): RenderedEmail | null {
  switch (type) {
    case 'application_created': {
      const parsed = parsePayload(type, payload)
      return parsed ? buildApplicationCreated(parsed) : null
    }
    case 'analysis_completed': {
      const parsed = parsePayload(type, payload)
      return parsed ? buildAnalysisCompleted(parsed) : null
    }
    case 'candidate_replied': {
      const parsed = parsePayload(type, payload)
      return parsed ? buildCandidateReplied(parsed) : null
    }
    default:
      return null
  }
}

/** One-line summary of an event for the daily digest list. */
export function summarizeNotification(type: NotificationType, payload: Record<string, unknown>): string {
  const p = payload as Record<string, string | number | null>
  const name = escapeHtml(String(p.candidateName ?? 'A candidate'))
  const job = escapeHtml(String(p.jobTitle ?? 'a role'))
  switch (type) {
    case 'application_created':
      return `<strong>${name}</strong> applied for ${job}`
    case 'analysis_completed':
      return `<strong>${name}</strong> was scored for ${job}${p.compositeScore != null ? ` (${escapeHtml(String(p.compositeScore))}/100)` : ''}`
    case 'candidate_replied':
      return `<strong>${name}</strong> replied about ${job}`
    default:
      return name
  }
}

/**
 * Render the daily digest email grouping several pending rows for one recipient.
 * `dashboardUrl` deep-links to the dashboard so the CTA always works even though
 * the individual rows may point at different applications.
 */
export function renderDigest(params: {
  items: Array<{ type: NotificationType, payload: Record<string, unknown>, applicationUrl: string }>
  dashboardUrl: string
}): RenderedEmail | null {
  const validItems = params.items.every(item => parsePayload(item.type, {
    ...item.payload,
    applicationUrl: item.applicationUrl,
  }))
  if (!validItems || params.items.length === 0) return null

  const count = params.items.length
  const subject = `Your Reqcore digest — ${count} update${count === 1 ? '' : 's'}`
  const rowsHtml = params.items.map(item =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:14px;line-height:1.5;color:#3f3f46;">`
    + `<a href="${escapeHtml(item.applicationUrl)}" style="color:#3f3f46;text-decoration:none;">${summarizeNotification(item.type, item.payload)}</a>`
    + `</td></tr>`,
  ).join('')
  const rowsText = params.items.map((item) => {
    const p = item.payload as Record<string, unknown>
    return `• ${String(p.candidateName ?? 'A candidate')} — ${String(p.jobTitle ?? 'a role')}\n  ${item.applicationUrl}`
  }).join('\n')

  return {
    subject,
    html: renderNotificationLayout({
      title: subject,
      heading: `${count} update${count === 1 ? '' : 's'} today`,
      bodyHtml:
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">Here's what happened across your roles.</p>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rowsHtml}</table>`,
      cta: { label: 'Open dashboard', url: params.dashboardUrl },
    }),
    text: [
      `${count} update${count === 1 ? '' : 's'} today`,
      '',
      rowsText,
      '',
      `Open dashboard: ${params.dashboardUrl}`,
      '',
      '— Reqcore',
    ].join('\n'),
  }
}
