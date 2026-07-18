import { describe, it, expect } from 'vitest'
import { isDisposableEmailDomain } from '../../server/utils/disposable-email-domains'

/**
 * Pure-layer coverage for the signup disposable-domain denylist
 * (server/utils/auth.ts blocks these in a databaseHooks.user.create.before hook).
 */
describe('isDisposableEmailDomain', () => {
  it('blocks the domain from the invitation-spam incident', () => {
    expect(isDisposableEmailDomain('vomomo6110@fishnone.com')).toBe(true)
  })

  it('blocks well-known disposable providers', () => {
    expect(isDisposableEmailDomain('a@mailinator.com')).toBe(true)
    expect(isDisposableEmailDomain('b@guerrillamail.com')).toBe(true)
    expect(isDisposableEmailDomain('c@yopmail.com')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isDisposableEmailDomain('User@MailInator.COM')).toBe(true)
  })

  it('blocks subdomains of a denied provider (evasion guard)', () => {
    expect(isDisposableEmailDomain('x@inbox.mailinator.com')).toBe(true)
    expect(isDisposableEmailDomain('x@a.b.guerrillamail.com')).toBe(true)
  })

  it('allows normal / corporate email domains', () => {
    expect(isDisposableEmailDomain('jane@gmail.com')).toBe(false)
    expect(isDisposableEmailDomain('dev@reqcore.com')).toBe(false)
    expect(isDisposableEmailDomain('hire@acme.co')).toBe(false)
    expect(isDisposableEmailDomain('qa@test.local')).toBe(false)
  })

  it('does not match on a substring of a legitimate domain', () => {
    // "temp-mail.org" is blocked but "mytempmailservice.com" must not be.
    expect(isDisposableEmailDomain('a@mytempmailservice.com')).toBe(false)
    // "notmailinator.com" is a different registrable domain.
    expect(isDisposableEmailDomain('a@notmailinator.com')).toBe(false)
  })

  it('returns false for malformed addresses rather than throwing', () => {
    expect(isDisposableEmailDomain('not-an-email')).toBe(false)
    expect(isDisposableEmailDomain('trailing@')).toBe(false)
    expect(isDisposableEmailDomain('@leading.com')).toBe(false)
    expect(isDisposableEmailDomain('')).toBe(false)
  })
})
