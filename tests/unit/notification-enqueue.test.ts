import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recipientsMock } = vi.hoisted(() => ({ recipientsMock: vi.fn() }))
vi.mock('../../server/utils/notifications/recipients', () => ({
  resolveRecipients: recipientsMock,
}))

const { digestBucketFor, digestDeliveryAt, enqueueNotification } = await import('../../server/utils/notifications/enqueue')

function insertionDb() {
  const stored = new Map<string, Record<string, unknown>>()
  return {
    stored,
    db: {
      insert: () => ({
        values: (rows: Array<Record<string, unknown>>) => ({
          onConflictDoNothing: async () => {
            for (const row of rows) {
              const key = String(row.dedupeKey)
              if (!stored.has(key)) stored.set(key, row)
            }
          },
        }),
      }),
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('logWarn', vi.fn())
  recipientsMock.mockResolvedValue([
    { userId: 'u1', email: 'one@example.com', cadence: 'instant' },
    { userId: 'u2', email: 'two@example.com', cadence: 'digest' },
  ])
})

afterEach(() => {
  vi.unstubAllGlobals()
  recipientsMock.mockReset()
})

describe('enqueueNotification', () => {
  it('deduplicates each recipient and schedules digest delivery at 08:00 UTC', async () => {
    const { db, stored } = insertionDb()
    vi.stubGlobal('db', db)
    const event = {
      organizationId: 'org1',
      type: 'application_created' as const,
      dedupeKey: 'application_created:app1',
      payload: { applicationId: 'app1' },
    }

    await enqueueNotification(event)
    await enqueueNotification(event)

    expect(stored.size).toBe(2)
    expect([...stored.keys()]).toEqual([
      'application_created:app1:u1',
      'application_created:app1:u2',
    ])
    const digest = stored.get('application_created:app1:u2')!
    expect(digest.digestBucket).toBeTypeOf('string')
    expect((digest.nextAttemptAt as Date).toISOString()).toBe(`${digest.digestBucket}T08:00:00.000Z`)
  })

  it('propagates failures when participating in a domain transaction', async () => {
    recipientsMock.mockRejectedValue(new Error('database unavailable'))
    const tx = {} as never

    await expect(enqueueNotification({
      organizationId: 'org1',
      type: 'candidate_replied',
      dedupeKey: 'candidate_replied:m1',
      payload: {},
      tx,
    })).rejects.toThrow('database unavailable')
  })

  it('logs and swallows failures outside a transaction', async () => {
    recipientsMock.mockRejectedValue(new Error('database unavailable'))
    vi.stubGlobal('db', {})

    await expect(enqueueNotification({
      organizationId: 'org1',
      type: 'candidate_replied',
      dedupeKey: 'candidate_replied:m1',
      payload: {},
    })).resolves.toBeUndefined()
    expect(logWarn).toHaveBeenCalledWith('notification.enqueue_failed', expect.any(Object))
  })
})

describe('digest bucketing', () => {
  it('uses today before 08:00 UTC and tomorrow at or after the cutoff', () => {
    expect(digestBucketFor(new Date('2026-01-02T07:59:59Z'))).toBe('2026-01-02')
    expect(digestBucketFor(new Date('2026-01-02T08:00:00Z'))).toBe('2026-01-03')
    expect(digestDeliveryAt('2026-01-03').toISOString()).toBe('2026-01-03T08:00:00.000Z')
  })
})
