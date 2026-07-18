import { createError } from 'h3'

export const EMAIL_VERIFICATION_REQUIRED_CODE = 'EMAIL_VERIFICATION_REQUIRED'

export const deferredEmailVerification = {
  requireBeforeSignIn: false,
  sendOnSignUp: true,
} as const

type EmailVerificationUser = {
  email: string
  emailVerified: boolean
}

/** Require proof of mailbox ownership immediately before a user-triggered send. */
export function assertEmailVerified(user: EmailVerificationUser): void {
  if (user.emailVerified) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Verify your email before sending invitations or candidate messages.',
    data: {
      code: EMAIL_VERIFICATION_REQUIRED_CODE,
      email: user.email,
    },
  })
}

export function isOrganizationInvitationSend(path: string, method: string): boolean {
  return method === 'POST' && path === '/organization/invite-member'
}
