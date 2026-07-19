import { describe, expect, it } from 'vitest'
import {
  candidateForwardAddress,
  createCandidateForwardToken,
  extractResumeIdentity,
  findCandidateForwardToken,
  hashCandidateForwardToken,
  mergeCandidateIdentities,
  parseForwardedCandidateIdentity,
} from '../../ee/server/utils/candidate-forwarding'

describe('candidate forwarding tokens', () => {
  it('creates a 192-bit opaque token and routes only the exact receiving domain', () => {
    const token = createCandidateForwardToken()
    expect(token).toMatch(/^[a-f0-9]{48}$/)
    const address = candidateForwardAddress(token, 'Reply.Example.com')
    expect(address).toBe(`candidate-${token}@reply.example.com`)
    expect(findCandidateForwardToken([`Reqcore <${address}>`], 'reply.example.com')).toBe(token)
    expect(findCandidateForwardToken([address], 'other.example.com')).toBeNull()
  })

  it('hashes tokens deterministically without exposing the token', () => {
    const token = 'a'.repeat(48)
    const hash = hashCandidateForwardToken(token)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(token)
    expect(hashCandidateForwardToken(token)).toBe(hash)
  })

  it('rejects malformed local parts', () => {
    expect(findCandidateForwardToken(['candidate-short@reply.example.com'], 'reply.example.com')).toBeNull()
    expect(findCandidateForwardToken([`reply-${'a'.repeat(48)}@reply.example.com`], 'reply.example.com')).toBeNull()
  })
})

describe('forwarded candidate parsing', () => {
  it('extracts the original Gmail sender instead of the forwarding recruiter', () => {
    const text = [
      'Please add this person.',
      '',
      '---------- Forwarded message ---------',
      'From: Ada Lovelace <Ada@Example.com>',
      'Date: Sun, Jul 19, 2026 at 10:00 AM',
      'Subject: Application',
      'To: Recruiter <recruiter@company.com>',
    ].join('\n')
    expect(parseForwardedCandidateIdentity(text, null)).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    })
  })

  it('supports common localized From headers', () => {
    const text = '---------- Videresendt melding ---------\nFra: Kari Nordmann <kari@example.no>\nEmne: Søknad'
    expect(parseForwardedCandidateIdentity(text, null)).toEqual({
      name: 'Kari Nordmann',
      email: 'kari@example.no',
    })
  })

  it('does not treat an arbitrary address outside a forwarded From header as the candidate', () => {
    expect(parseForwardedCandidateIdentity(
      'Recruiter recruiter@company.com says the resume is attached.',
      null,
    )).toEqual({ name: '', email: '' })
  })

  it('uses a conservative resume fallback and preserves forwarded values', () => {
    const resume = extractResumeIdentity('Grace Hopper\ngrace@navy.mil\nEXPERIENCE\nCompiler design')
    expect(resume).toEqual({ name: 'Grace Hopper', email: 'grace@navy.mil' })
    expect(mergeCandidateIdentities(
      { name: 'Grace Brewster Hopper', email: '' },
      [resume],
    )).toEqual({ name: 'Grace Brewster Hopper', email: 'grace@navy.mil' })
  })
})
