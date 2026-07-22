import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown) => Promise<unknown>

let handler: Handler

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (value: Handler) => value)
  handler = (await import('../../server/api/applications/[id].delete')).default as Handler
})

function httpError(input: { statusCode: number, statusMessage: string }) {
  return Object.assign(new Error(input.statusMessage), input)
}

function makeDb(options: {
  applicationExists?: boolean
  interviews?: Array<{
    id: string
    status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
    invitationSentAt: Date | null
    googleCalendarEventId: string | null
    createdById: string
  }>
  attachmentKeys?: string[]
} = {}) {
  const txDelete = vi.fn(() => ({
    where: vi.fn(() => Object.assign(Promise.resolve(), {
      returning: vi.fn(async () => [{ id: 'application-1' }]),
    })),
  }))
  const transaction = vi.fn(async (callback: (tx: { delete: typeof txDelete }) => Promise<void>) => {
    await callback({ delete: txDelete })
  })

  return {
    txDelete,
    transaction,
    db: {
      query: {
        application: {
          findFirst: vi.fn(async () => options.applicationExists === false ? undefined : { id: 'application-1' }),
        },
        interview: {
          findMany: vi.fn(async () => options.interviews ?? []),
        },
        candidateConversation: {
          findMany: vi.fn(async () => options.attachmentKeys?.length ? [{ id: 'conversation-1' }] : []),
        },
        candidateMessage: {
          findMany: vi.fn(async () => options.attachmentKeys?.length ? [{ id: 'message-1' }] : []),
        },
        candidateMessageAttachment: {
          findMany: vi.fn(async () => (options.attachmentKeys ?? []).map(storageKey => ({ storageKey }))),
        },
      },
      transaction,
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('requirePermission', vi.fn(async () => ({
    session: { activeOrganizationId: 'org-1' },
    user: { id: 'user-1' },
  })))
  vi.stubGlobal('getValidatedRouterParams', vi.fn(async () => ({ id: 'application-1' })))
  vi.stubGlobal('createError', httpError)
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('recordActivity', vi.fn())
  vi.stubGlobal('deleteFromS3', vi.fn(async () => {}))
  vi.stubGlobal('logWarn', vi.fn())
  vi.stubGlobal('logError', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DELETE /api/applications/:id', () => {
  it('requires application delete permission and removes the dependent graph transactionally', async () => {
    const mock = makeDb()
    vi.stubGlobal('db', mock.db)

    await expect(handler({})).resolves.toBeNull()

    expect(requirePermission).toHaveBeenCalledWith({}, { application: ['delete'] })
    expect(mock.transaction).toHaveBeenCalledOnce()
    expect(mock.txDelete).toHaveBeenCalledTimes(3)
    expect(setResponseStatus).toHaveBeenCalledWith({}, 204)
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1',
      action: 'deleted',
      resourceType: 'application',
      resourceId: 'application-1',
    }))
  })

  it('returns 404 without deleting when the application is outside the organization', async () => {
    const mock = makeDb({ applicationExists: false })
    vi.stubGlobal('db', mock.db)

    await expect(handler({})).rejects.toMatchObject({ statusCode: 404 })
    expect(mock.transaction).not.toHaveBeenCalled()
  })

  it('requires an invited scheduled interview to be cancelled first', async () => {
    const mock = makeDb({
      interviews: [{
        id: 'interview-1',
        status: 'scheduled',
        invitationSentAt: new Date(),
        googleCalendarEventId: null,
        createdById: 'user-1',
      }],
    })
    vi.stubGlobal('db', mock.db)

    await expect(handler({})).rejects.toMatchObject({ statusCode: 409 })
    expect(mock.transaction).not.toHaveBeenCalled()
  })

  it('best-effort removes message attachments without blocking database deletion', async () => {
    const mock = makeDb({ attachmentKeys: ['applications/message.txt'] })
    vi.stubGlobal('db', mock.db)
    vi.mocked(deleteFromS3).mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(handler({})).resolves.toBeNull()

    expect(deleteFromS3).toHaveBeenCalledWith('applications/message.txt')
    expect(logWarn).toHaveBeenCalledWith(
      'application.attachment_delete_failed',
      expect.objectContaining({ application_id: 'application-1' }),
    )
    expect(mock.transaction).toHaveBeenCalledOnce()
  })
})
