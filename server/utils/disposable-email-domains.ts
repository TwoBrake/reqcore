/**
 * Disposable / throwaway email domain denylist.
 *
 * Signups from disposable-mail providers are the entry point for abuse: they
 * give an attacker an unlimited supply of "verifiable" throwaway accounts. The
 * incident that motivated this used `vomomo6110@fishnone.com`. Blocking these
 * domains at account creation — together with send-time email verification —
 * removes the cheap-identity supply that makes email-relay abuse economical.
 *
 * This is intentionally a curated static list of the highest-volume providers
 * plus the domains seen in abuse, not an exhaustive database. It is enforced in
 * a Better Auth `databaseHooks.user.create.before` hook, so it covers every
 * signup path (email/password, social, OIDC). Operators can extend it at runtime
 * without a code change via the comma-separated `BLOCKED_EMAIL_DOMAINS` env var.
 */

const STATIC_DISPOSABLE_DOMAINS: readonly string[] = [
  // Domain seen in the invitation-spam incident and its known siblings.
  'fishnone.com',
  // High-volume disposable / temp-mail providers.
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamail.biz',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'mailinator.com',
  'mailinator.net',
  'mailinator2.com',
  'maildrop.cc',
  'mailnesia.com',
  'mailcatch.com',
  'mailtemp.info',
  'temp-mail.org',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'tempmailaddress.com',
  'throwawaymail.com',
  'throwaway.email',
  'getnada.com',
  'nada.email',
  'dispostable.com',
  'yopmail.com',
  'yopmail.net',
  'yopmail.fr',
  'trashmail.com',
  'trashmail.net',
  'trash-mail.com',
  'mytemp.email',
  'moakt.com',
  'mohmal.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemailgenerator.com',
  'spam4.me',
  'discard.email',
  'mailsac.com',
  'inboxkitten.com',
  'burnermail.io',
  'tmpmail.org',
  'tmpmail.net',
  'tmail.ws',
  'mintemail.com',
  'wegwerfmail.de',
  'einrot.com',
  'cuvox.de',
  'dayrep.com',
  'rhyta.com',
  'teleworm.us',
  'maileater.com',
  'mail-temp.com',
  'luxusmail.org',
  'vomoto.com',
  'harakirimail.com',
]

/**
 * Domains blocked at signup: the static denylist plus any operator additions
 * from the `BLOCKED_EMAIL_DOMAINS` env var (comma-separated). Built once.
 */
function buildBlockedDomains(): ReadonlySet<string> {
  const set = new Set(STATIC_DISPOSABLE_DOMAINS.map((d) => d.toLowerCase()))
  const extra = process.env.BLOCKED_EMAIL_DOMAINS
  if (extra) {
    for (const raw of extra.split(',')) {
      const domain = raw.trim().toLowerCase()
      if (domain) set.add(domain)
    }
  }
  return set
}

let _blockedDomains: ReadonlySet<string> | undefined
function blockedDomains(): ReadonlySet<string> {
  if (!_blockedDomains) _blockedDomains = buildBlockedDomains()
  return _blockedDomains
}

/**
 * Extract the lowercased domain part of an email address, or null if the input
 * is not a well-formed `local@domain` string.
 */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).trim().toLowerCase()
}

/**
 * True when the email's domain (or any parent domain) is on the disposable
 * denylist. Parent-domain matching catches subdomain evasion
 * (e.g. `x.mailinator.com` → blocked via `mailinator.com`).
 */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = emailDomain(email)
  if (!domain) return false
  const blocked = blockedDomains()
  if (blocked.has(domain)) return true

  // Match parent domains so subdomains of a blocked provider are also blocked.
  const labels = domain.split('.')
  for (let i = 1; i < labels.length - 1; i++) {
    if (blocked.has(labels.slice(i).join('.'))) return true
  }
  return false
}
