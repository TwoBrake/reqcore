import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock, featureMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  featureMock: vi.fn(),
}))
vi.mock('../../server/utils/email', () => ({ sendNotificationEmail: sendMock }))
vi.mock('../../server/utils/featureFlags', () => ({ isServerFeatureEnabled: featureMock }))

const { runNotificationDispatch, runNotificationDigest } = await import('../../server/utils/notifications/dispatch')

function queryable(result: unknown) {
  const p = Promise.resolve(result)
  const proxy: unknown = new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === 'then') return p.then.bind(p)
      if (prop === 'catch') return p.catch.bind(p)
      if (prop === 'finally') return p.finally.bind(p)
      return () => proxy
    },
  })
  return proxy
}

function makeDb(selectResults: unknown[][], returningResults: unknown[][] = []) {
  const setCalls: Array<Record<string, unknown>> = []
  let selectIndex = 0
  let returningIndex = 0

  const database: Record<string, unknown> = {
    select: () => queryable(selectResults[selectIndex++] ?? []),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        setCalls.push(vals)
        return {
          where: () => {
            const promise = Promise.resolve()
            return Object.assign(promise, {
              returning: () => Promise.resolve(returningResults[returningIndex++] ?? []),
            })
          },
        }
      },
    }),
  }
  database.transaction = async (callback: (tx: unknown) => unknown) => callback(database)
  return { db: database, setCalls }
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox_1',
    organizationId: 'org1',
    recipientUserId: 'u1',
    recipientEmail: 'rec@example.com',
    type: 'application_created',
    cadence: 'instant',
    payload: { applicationId: 'app1', candidateName: 'Jane', jobTitle: 'Engineer' },
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date('2026-01-01T00:00:00Z'),
    digestBucket: null,
    providerMessageId: null,
    sentAt: null,
    failedAt: null,
    lastError: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('logInfo', vi.fn())
  vi.stubGlobal('logWarn', vi.fn())
  vi.stubGlobal('logError', vi.fn())
  featureMock.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sendMock.mockReset()
  featureMock.mockReset()
})

describe('runNotificationDispatch', () => {
  it('does nothing when the global kill-switch is off', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: false })
    const select = vi.fn()
    vi.stubGlobal('db', { select })

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.enabled).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })

  it('claims and marks an instant row sent with its provider message id', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://app.example.com' })
    const row = pendingRow()
    const { db, setCalls } = makeDb([[{ id: row.id }], [], []], [[row]])
    vi.stubGlobal('db', db)
    sendMock.mockResolvedValue({ providerMessageId: 'prov_1' })

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.sent).toBe(1)
    expect(setCalls[0]!.nextAttemptAt).toBeInstanceOf(Date)
    expect(setCalls[1]).toMatchObject({ status: 'sent', providerMessageId: 'prov_1' })
  })

  it('links invitation responses directly to the interview', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://app.example.com' })
    const row = pendingRow({
      type: 'interview_response',
      payload: {
        interviewId: 'interview1',
        candidateName: 'Jane',
        jobTitle: 'Engineer',
        interviewTitle: 'Technical interview',
        response: 'accepted',
      },
    })
    const { db } = makeDb([[{ id: row.id }], [], []], [[row]])
    vi.stubGlobal('db', db)
    sendMock.mockResolvedValue({ providerMessageId: 'prov_2' })

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining('https://app.example.com/dashboard/interviews/interview1'),
      type: 'interview_response',
    }))
  })

  it('does not send when another worker wins the claim', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true })
    const { db } = makeDb([[{ id: 'outbox_1' }], []], [[]])
    vi.stubGlobal('db', db)

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.processed).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('schedules the first failed attempt one minute later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://app.example.com' })
    const row = pendingRow()
    const { db, setCalls } = makeDb([[{ id: row.id }], [], []], [[row]])
    vi.stubGlobal('db', db)
    sendMock.mockRejectedValue(new Error('resend down'))

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.retried).toBe(1)
    expect(setCalls[1]).toMatchObject({ attempts: 1 })
    expect((setCalls[1]!.nextAttemptAt as Date).getTime()).toBe(Date.now() + 60_000)
  })

  it('dead-letters a row on its sixth failed attempt', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://app.example.com' })
    const row = pendingRow({ attempts: 5 })
    const { db, setCalls } = makeDb([[{ id: row.id }], [], []], [[row]])
    vi.stubGlobal('db', db)
    sendMock.mockRejectedValue(new Error('resend down'))

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.dead).toBe(1)
    expect(setCalls[1]).toMatchObject({ status: 'dead', attempts: 6 })
  })

  it('skips a claimed row whose address became suppressed', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true })
    const row = pendingRow()
    const { db, setCalls } = makeDb([[{ id: row.id }], [{ id: 'suppression_1' }], []], [[row]])
    vi.stubGlobal('db', db)

    const result = await runNotificationDispatch({ source: 'interactive' })

    expect(result.skipped).toBe(1)
    expect(setCalls[1]).toMatchObject({ status: 'skipped', lastError: 'email_suppressed' })
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('runNotificationDigest', () => {
  it('isolates a digest group and uses a stable organization/user/bucket key', async () => {
    vi.stubGlobal('env', { NOTIFICATIONS_ENABLED: true, BETTER_AUTH_URL: 'https://app.example.com' })
    const row = pendingRow({
      cadence: 'digest',
      digestBucket: '2026-01-02',
    })
    const group = {
      organizationId: row.organizationId,
      recipientUserId: row.recipientUserId,
      recipientEmail: row.recipientEmail,
      digestBucket: row.digestBucket,
    }
    const { db, setCalls } = makeDb([[group], []], [[row]])
    vi.stubGlobal('db', db)
    sendMock.mockResolvedValue({ providerMessageId: 'digest_provider' })

    const result = await runNotificationDigest({ source: 'interactive' })

    expect(result.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'digest:org1:u1:2026-01-02',
    }))
    expect(setCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'sent', providerMessageId: null }),
      expect.objectContaining({ providerMessageId: 'digest_provider' }),
    ]))
  })
})
