/**
 * Abuse-prevention limits for outbound side effects.
 *
 * Background: the org invitation system was abused to relay spam through our
 * email provider — an unverified account created throwaway organizations and
 * blasted invitations to unrelated addresses. These caps bound the blast radius
 * of any single account/organization on every endpoint that triggers outbound
 * email, independent of email verification (which proves mailbox ownership) and
 * plan-based business limits (which meter legitimate usage, not abuse).
 *
 * The numbers are deliberately generous for real recruiting teams and tight
 * enough that a hijacked or throwaway account cannot turn Reqcore into a spam
 * relay. Tune here — every enforcement point imports these constants.
 */
export const OUTBOUND_LIMITS = {
  /**
   * Maximum organizations a single user may create. Caps the "spin up throwaway
   * orgs to reset per-org quotas" pattern. Belonging to more orgs via invitation
   * is unaffected — this only limits creation.
   */
  maxOrganizationsPerUser: 3,

  /**
   * Maximum simultaneously-pending invitations per organization. Enforced by
   * Better Auth's `invitationLimit`. Combined with the 48h expiry this is the
   * hard ceiling on concurrent invitation spam from one org.
   */
  pendingInvitesPerOrg: 25,

  /**
   * Maximum organization invitations created per organization per rolling hour.
   */
  orgInvitesPerHour: 30,

  /**
   * Maximum outbound candidate emails per organization per rolling hour.
   * Covers both free-form candidate messages and interview invitations —
   * they share the same `candidate_message` table and Resend sender, so a
   * single per-org cap bounds total mail relayed through that channel.
   */
  outboundMessagesPerHour: 80,
} as const

/** Rolling window (ms) all the per-hour limits above are measured over. */
export const OUTBOUND_LIMIT_WINDOW_MS = 60 * 60 * 1000
