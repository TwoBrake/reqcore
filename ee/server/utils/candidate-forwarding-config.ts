import { isDedicatedReplyDomain } from './candidate-messaging'

export function candidateForwardingConfig(): {
  available: boolean
  domain: string | null
  missing: string[]
} {
  const missing: string[] = []
  if (!env.RESEND_RECEIVING_API_KEY) missing.push('RESEND_RECEIVING_API_KEY')
  if (!env.RESEND_REPLY_DOMAIN) missing.push('RESEND_REPLY_DOMAIN')
  if (!env.RESEND_WEBHOOK_SECRET) missing.push('RESEND_WEBHOOK_SECRET')

  const domain = env.RESEND_REPLY_DOMAIN?.trim().toLowerCase() ?? null
  if (domain && !isDedicatedReplyDomain(env.RESEND_FROM_EMAIL, domain)) {
    missing.push('DEDICATED_RESEND_REPLY_DOMAIN')
  }

  return { available: missing.length === 0, domain, missing }
}

export function requireCandidateForwardingConfig(): { domain: string; webhookSecret: string } {
  const config = candidateForwardingConfig()
  if (!config.available || !config.domain || !env.RESEND_WEBHOOK_SECRET) {
    throw createError({
      statusCode: 503,
      statusMessage: `Candidate forwarding is not configured (${config.missing.join(', ')})`,
      data: { code: 'CANDIDATE_FORWARDING_NOT_CONFIGURED', missing: config.missing },
    })
  }
  return { domain: config.domain, webhookSecret: env.RESEND_WEBHOOK_SECRET }
}
