import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NotificationStatusEvent } from '../../server/utils/notifications/delivery-status'
import { processNotificationStatusEvent } from '../../server/utils/notifications/delivery-status'

function statusEvent(type: NotificationStatusEvent['type'], extra: Record<string, unknown> = {}) {
  return {
    type,
    created_at: '2026-01-02T09:00:00.000Z',
    data: {
      email_id: 'provider_1',
      ...extra,
    },
  } as unknown as NotificationStatusEvent
}

function makeDb(row: Record<string, unknown> | undefined) {
  const setCalls: Array<Record<string, unknown>> = []
  const inserted: Array<Record<string, unknown>> = []
  return {
    setCalls,
    inserted,
    db: {
      query: { notificationOutbox: { findFirst: vi.fn().mockResolvedValue(row) } },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          setCalls.push(values)
          return { where: () => Promise.resolve() }
        },
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values)
          return { onConflictDoNothing: () => Promise.resolve() }
        },
      }),
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('processNotificationStatusEvent', () => {
  const instantRow = {
    id: 'outbox_1',
    organizationId: 'org1',
    recipientUserId: 'u1',
    recipientEmail: 'Recruiter@Example.COM ',
    cadence: 'instant',
    digestBucket: null,
  }

  it('marks a permanent bounce dead and suppresses the normalized address', async () => {
    const { db, setCalls, inserted } = makeDb(instantRow)
    vi.stubGlobal('db', db)

    await processNotificationStatusEvent(statusEvent('email.bounced', {
      bounce: { type: 'Permanent', message: 'Mailbox does not exist' },
    }))

    expect(setCalls[0]).toMatchObject({ status: 'dead', lastError: 'Permanent: Mailbox does not exist' })
    expect(inserted[0]).toEqual({ email: 'recruiter@example.com', reason: 'bounce' })
  })

  it('marks a soft bounce dead without permanently suppressing the address', async () => {
    const { db, setCalls, inserted } = makeDb(instantRow)
    vi.stubGlobal('db', db)

    await processNotificationStatusEvent(statusEvent('email.bounced', {
      bounce: { type: 'Transient', message: 'Try again later' },
    }))

    expect(setCalls[0]).toMatchObject({ status: 'dead' })
    expect(inserted).toHaveLength(0)
  })

  it('keeps a delivered outbox row sent', async () => {
    const { db, setCalls } = makeDb(instantRow)
    vi.stubGlobal('db', db)

    await processNotificationStatusEvent(statusEvent('email.delivered'))

    expect(setCalls[0]!.status).toBeUndefined()
    expect(setCalls[0]!.failedAt).toBeUndefined()
  })

  it('updates a digest delivery through its leader row', async () => {
    const { db, setCalls } = makeDb({ ...instantRow, cadence: 'digest', digestBucket: '2026-01-02' })
    vi.stubGlobal('db', db)

    await processNotificationStatusEvent(statusEvent('email.failed', {
      failed: { reason: 'rejected' },
    }))

    expect(setCalls[0]).toMatchObject({ status: 'dead', lastError: 'failed: rejected' })
  })
})
