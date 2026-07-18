import { describe, expect, it } from 'vitest'
import {
  EMAIL_VERIFICATION_REQUIRED_CODE,
  assertEmailVerified,
  deferredEmailVerification,
  isOrganizationInvitationSend,
} from '../../server/utils/email-verification'

describe('deferred email verification', () => {
  it('creates the session before verification while sending a link on signup', () => {
    expect(deferredEmailVerification).toEqual({
      requireBeforeSignIn: false,
      sendOnSignUp: true,
    })
  })

  it('allows verified users to trigger outbound email', () => {
    expect(() => assertEmailVerified({
      email: 'owner@example.com',
      emailVerified: true,
    })).not.toThrow()
  })

  it('blocks unverified users at the outbound boundary', () => {
    try {
      assertEmailVerified({
        email: 'owner@example.com',
        emailVerified: false,
      })
      throw new Error('Expected assertEmailVerified to throw')
    }
    catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        statusMessage: 'Verify your email before sending invitations or candidate messages.',
        data: {
          code: EMAIL_VERIFICATION_REQUIRED_CODE,
          email: 'owner@example.com',
        },
      })
    }
  })

  it('identifies only the organization invitation send endpoint', () => {
    expect(isOrganizationInvitationSend('/organization/invite-member', 'POST')).toBe(true)
    expect(isOrganizationInvitationSend('/organization/invite-member', 'GET')).toBe(false)
    expect(isOrganizationInvitationSend('/organization/create', 'POST')).toBe(false)
    expect(isOrganizationInvitationSend('/organization/cancel-invitation', 'POST')).toBe(false)
  })
})
