import { describe, expect, it } from 'vitest'
import { resolveRecipients, type NotificationDbClient } from '../../server/utils/notifications/recipients'

/**
 * Minimal fake Drizzle client whose `.select()` chains resolve to a queued list
 * of results, in call order. resolveRecipients runs exactly three selects:
 * members, preferences, then suppressed addresses.
 */
function fakeDb(resultsInOrder: unknown[]): NotificationDbClient {
  let i = 0
  function makeChain() {
    const current = resultsInOrder[i]
    const p = Promise.resolve(current)
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') { i++; return p.then.bind(p) }
        if (prop === 'catch') return p.catch.bind(p)
        if (prop === 'finally') return p.finally.bind(p)
        return () => proxy
      },
    })
    return proxy
  }
  return { select: () => makeChain() } as unknown as NotificationDbClient
}

describe('resolveRecipients', () => {
  it('applies defaults, honors off/instant, and excludes suppressed addresses', async () => {
    const members = [
      { userId: 'a', email: 'a@example.com' }, // no pref → default (digest for application_created)
      { userId: 'b', email: 'b@example.com' }, // pref: off → excluded
      { userId: 'c', email: 'c@example.com' }, // pref: instant
      { userId: 'd', email: 'd@example.com' }, // suppressed → excluded
    ]
    const prefs = [
      { userId: 'b', channelMode: 'off' },
      { userId: 'c', channelMode: 'instant' },
    ]
    const suppressed = [{ email: 'd@example.com' }]

    const recipients = await resolveRecipients(
      'org1',
      'application_created',
      fakeDb([members, prefs, suppressed]),
    )

    expect(recipients).toEqual([
      { userId: 'a', email: 'a@example.com', cadence: 'digest' },
      { userId: 'c', email: 'c@example.com', cadence: 'instant' },
    ])
  })

  it('returns no recipients when the org has no members', async () => {
    const recipients = await resolveRecipients('org1', 'candidate_replied', fakeDb([[]]))
    expect(recipients).toEqual([])
  })

  it('never returns the shared demo account as an email recipient', async () => {
    const members = [
      { userId: 'demo', email: 'demo@reqcore.com' },
      { userId: 'recruiter', email: 'recruiter@example.com' },
    ]

    const recipients = await resolveRecipients(
      'org1',
      'candidate_replied',
      fakeDb([members, [], []]),
    )

    expect(recipients).toEqual([
      { userId: 'recruiter', email: 'recruiter@example.com', cadence: 'instant' },
    ])
  })
})
