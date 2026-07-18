import { isDedicatedReplyDomain } from './candidate-messaging'

export function requireCandidateMessagingConfig() {
  const missing: string[] = []
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY')
  if (!env.RESEND_RECEIVING_API_KEY) missing.push('RESEND_RECEIVING_API_KEY')
  if (!env.RESEND_REPLY_DOMAIN) missing.push('RESEND_REPLY_DOMAIN')
  if (!env.RESEND_WEBHOOK_SECRET) missing.push('RESEND_WEBHOOK_SECRET')

  if (missing.length > 0) {
    throw createError({
      statusCode: 503,
      statusMessage: `Candidate messaging is not configured (${missing.join(', ')})`,
      data: { code: 'CANDIDATE_MESSAGING_NOT_CONFIGURED', missing },
    })
  }

  const replyDomain = (env.RESEND_REPLY_DOMAIN as string).toLowerCase()
  if (!isDedicatedReplyDomain(env.RESEND_FROM_EMAIL, replyDomain)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Candidate messaging requires a dedicated Resend receiving domain',
      data: {
        code: 'CANDIDATE_MESSAGING_INVALID_REPLY_DOMAIN',
        message: 'RESEND_REPLY_DOMAIN must use a dedicated receiving subdomain with Resend MX records.',
      },
    })
  }

  return {
    replyDomain,
    webhookSecret: env.RESEND_WEBHOOK_SECRET as string,
  }
}
