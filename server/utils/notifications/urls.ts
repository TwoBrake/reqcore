/**
 * Dashboard deep-link helpers for notification emails. Mirrors the base-URL
 * resolution used elsewhere (interview-conversation, google-calendar): explicit
 * BETTER_AUTH_URL wins, then the Railway public domain, then the marketing URL.
 *
 * Producers persist only ids in the outbox payload; the worker builds the full
 * URL at send time so links stay correct even if the deployment domain changes.
 */
export function appBaseUrl(): string {
  return env.BETTER_AUTH_URL
    || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')
    || 'https://reqcore.com'
}

export function applicationUrl(applicationId: string): string {
  return `${appBaseUrl()}/dashboard/applications/${applicationId}`
}

export function interviewUrl(interviewId: string): string {
  return `${appBaseUrl()}/dashboard/interviews/${interviewId}`
}

export function dashboardUrl(): string {
  return `${appBaseUrl()}/dashboard`
}

export function inboxConversationUrl(conversationId: string): string {
  const url = new URL('/dashboard/inbox', appBaseUrl())
  url.searchParams.set('conversation', conversationId)
  return url.toString()
}
