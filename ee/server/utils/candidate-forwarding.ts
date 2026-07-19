import { createHash, randomBytes } from 'node:crypto'
import { convert } from 'html-to-text'

export const CANDIDATE_FORWARD_TOKEN_BYTES = 24
export const CANDIDATE_FORWARD_MAX_ATTACHMENTS = 5
export const CANDIDATE_FORWARD_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const CANDIDATE_FORWARD_MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

const TOKEN_RE = /^[a-f0-9]{48}$/
const EMAIL_RE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i
const FORWARD_DELIMITER_RE = /(?:forwarded message|original message|videresendt melding|weitergeleitete nachricht|message transf[eé]r[eé]|mensaje reenviado|messaggio inoltrato)/i
const FROM_HEADER_RE = /^(?:from|fra|von|de|da|van|från)\s*:\s*(.+)$/i

export function createCandidateForwardToken(): string {
  return randomBytes(CANDIDATE_FORWARD_TOKEN_BYTES).toString('hex')
}

export function hashCandidateForwardToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function candidateForwardAddress(token: string, domain: string): string {
  if (!TOKEN_RE.test(token)) throw new Error('Invalid candidate forwarding token')
  return `candidate-${token}@${domain.trim().toLowerCase()}`
}

export function findCandidateForwardToken(addresses: string[], domain: string): string | null {
  const expectedDomain = domain.trim().toLowerCase()
  for (const value of addresses) {
    const angleAddress = value.match(/<([^<>]+)>/)?.[1]
    const address = (angleAddress ?? value).trim().toLowerCase()
    const at = address.lastIndexOf('@')
    if (at < 1 || address.slice(at + 1) !== expectedDomain) continue
    const localPart = address.slice(0, at)
    const token = localPart.startsWith('candidate-') ? localPart.slice('candidate-'.length) : ''
    if (TOKEN_RE.test(token)) return token
  }
  return null
}

export interface ForwardedCandidateIdentity {
  name: string
  email: string
}

/**
 * Parse the original sender from the header block Gmail/Outlook adds when an
 * email is manually forwarded. Envelope From is intentionally not a fallback:
 * it belongs to the recruiter, not the candidate.
 */
export function parseForwardedCandidateIdentity(
  text: string | null | undefined,
  html: string | null | undefined,
): ForwardedCandidateIdentity {
  const source = text?.trim() || (html ? convert(html, { wordwrap: false }).trim() : '')
  if (!source) return { name: '', email: '' }

  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const delimiterIndex = lines.findIndex(line => FORWARD_DELIMITER_RE.test(line))
  const searchStart = delimiterIndex >= 0 ? delimiterIndex + 1 : 0
  const searchEnd = Math.min(lines.length, searchStart + 30)

  for (let i = searchStart; i < searchEnd; i++) {
    const header = lines[i]?.trim().match(FROM_HEADER_RE)?.[1]?.trim()
    if (!header) continue
    const email = header.match(EMAIL_RE)?.[0]?.toLowerCase() ?? ''
    if (!email) continue
    const angleStart = header.lastIndexOf('<')
    const rawName = angleStart > 0 ? header.slice(0, angleStart) : header.replace(email, '')
    const name = rawName.replace(/^['"]|['"]$/g, '').trim().slice(0, 200)
    return { name, email }
  }

  return { name: '', email: '' }
}

/** Conservative fallback for resumes whose first line is a name. */
export function extractResumeIdentity(text: string | null | undefined): ForwardedCandidateIdentity {
  if (!text) return { name: '', email: '' }
  const email = text.match(EMAIL_RE)?.[0]?.toLowerCase() ?? ''
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12)
  const name = lines.find(line => (
    line.length <= 100
    && !line.includes('@')
    && !/\d{3,}/.test(line)
    && !/^(?:resume|curriculum vitae|cv|profile|summary)$/i.test(line)
    && line.split(/\s+/).length >= 2
    && line.split(/\s+/).length <= 6
  )) ?? ''
  return { name, email }
}

export function mergeCandidateIdentities(
  forwarded: ForwardedCandidateIdentity,
  resumes: ForwardedCandidateIdentity[],
): ForwardedCandidateIdentity {
  return {
    name: forwarded.name || resumes.find(identity => identity.name)?.name || '',
    email: forwarded.email || resumes.find(identity => identity.email)?.email || '',
  }
}

/** Download a provider URL without allowing an unexpectedly large response. */
export async function downloadCandidateAttachment(url: string, maxBytes: number): Promise<Buffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Attachment URL must use HTTPS')

  const response = await fetch(parsed, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok || !response.body) {
    throw new Error(`Attachment download failed with status ${response.status}`)
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > maxBytes) throw new Error('Attachment exceeds the size limit')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Attachment exceeds the size limit')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total)
}
