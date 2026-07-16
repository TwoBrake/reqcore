/**
 * HMAC-signed tokens for candidate interview responses.
 *
 * Tokens encode {interviewId, purpose, exp} and are signed with
 * BETTER_AUTH_SECRET using HMAC-SHA256. This allows candidates to
 * respond to an interview via a simple link — no
 * authentication required, no inbound email infrastructure needed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Default token expiry: 7 days */
const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const TOKEN_PURPOSE = 'interview_response'
const LEGACY_ACTIONS = ['accepted', 'declined', 'tentative']

interface TokenPayload {
  /** Interview UUID */
  id: string
  /** Prevents this token from being used by another signed-link flow */
  purpose: typeof TOKEN_PURPOSE
  /** Expiry timestamp (ms since epoch) */
  exp: number
}

interface DecodedTokenPayload {
  id?: unknown
  purpose?: unknown
  action?: unknown
  exp?: unknown
}

/**
 * Compute HMAC-SHA256 signature for a payload string.
 */
function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Generate a signed interview response token.
 *
 * Token format: base64url({id, purpose, exp}).signature
 * The signature prevents tampering; expiry prevents indefinite reuse.
 */
export function generateInterviewToken(
  interviewId: string,
  secret: string,
  expiryMs: number = DEFAULT_EXPIRY_MS,
): string {
  const payload: TokenPayload = {
    id: interviewId,
    purpose: TOKEN_PURPOSE,
    exp: Date.now() + expiryMs,
  }

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = sign(payloadStr, secret)

  return `${payloadStr}.${signature}`
}

/**
 * Verify and decode an interview response token.
 * Returns the payload if valid, or null if the signature is invalid or the token is expired.
 */
export function verifyInterviewToken(
  token: string,
  secret: string,
): TokenPayload | null {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null

  const payloadStr = token.slice(0, dotIndex)
  const providedSig = token.slice(dotIndex + 1)

  // Verify signature with timing-safe comparison
  const expectedSig = sign(payloadStr, secret)
  if (providedSig.length !== expectedSig.length) return null

  const providedSigBuffer = Buffer.from(providedSig, 'hex')
  const expectedSigBuffer = Buffer.from(expectedSig, 'hex')
  if (providedSigBuffer.length !== expectedSigBuffer.length) return null

  const sigValid = timingSafeEqual(providedSigBuffer, expectedSigBuffer)
  if (!sigValid) return null

  // Decode and validate payload
  let decodedPayload: DecodedTokenPayload
  try {
    const decoded = Buffer.from(payloadStr, 'base64url').toString('utf-8')
    decodedPayload = JSON.parse(decoded) as DecodedTokenPayload
  }
  catch {
    return null
  }

  // Validate structure
  if (
    typeof decodedPayload.id !== 'string'
    || typeof decodedPayload.exp !== 'number'
  ) {
    return null
  }

  // Action-bound tokens were sent before the flow moved to one neutral link.
  const isLegacyResponseToken = typeof decodedPayload.action === 'string'
    && LEGACY_ACTIONS.includes(decodedPayload.action)
  if (decodedPayload.purpose !== TOKEN_PURPOSE && !isLegacyResponseToken) return null

  // Check expiry
  if (Date.now() > decodedPayload.exp) return null

  return {
    id: decodedPayload.id,
    purpose: TOKEN_PURPOSE,
    exp: decodedPayload.exp,
  }
}

/**
 * Build the candidate response URL for an interview.
 */
export function buildResponseUrl(
  baseUrl: string,
  interviewId: string,
  secret: string,
): string {
  const token = generateInterviewToken(interviewId, secret)
  return `${baseUrl}/interview/respond?token=${encodeURIComponent(token)}`
}
