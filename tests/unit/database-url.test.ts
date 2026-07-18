import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl } from '../../server/utils/database-url'

describe('resolveDatabaseUrl', () => {
  it('keeps a valid database URL unchanged', () => {
    const url = 'postgresql://postgres:secret@postgres.internal:5432/railway'

    expect(resolveDatabaseUrl({ DATABASE_URL: url })).toBe(url)
  })

  it('rebuilds an invalid Railway preview URL from PG variables', () => {
    expect(resolveDatabaseUrl({
      DATABASE_URL: 'postgresql://postgres:secret@:5432/railway',
      PGHOST: 'postgres.railway.internal',
      PGPORT: '5432',
      PGUSER: 'postgres',
      PGPASSWORD: 'secret',
      PGDATABASE: 'railway',
    })).toBe('postgresql://postgres:secret@postgres.railway.internal:5432/railway')
  })

  it('falls back to Railway TCP proxy variables and encodes credentials', () => {
    expect(resolveDatabaseUrl({
      RAILWAY_TCP_PROXY_DOMAIN: 'proxy.railway.app',
      RAILWAY_TCP_PROXY_PORT: '18432',
      PGUSER: 'preview user',
      PGPASSWORD: 'p@ss/word',
      PGDATABASE: 'preview/db',
    })).toBe(
      'postgresql://preview%20user:p%40ss%2Fword@proxy.railway.app:18432/preview%2Fdb',
    )
  })

  it('returns an empty value when no hostname is available', () => {
    expect(resolveDatabaseUrl({
      DATABASE_URL: 'postgresql://postgres:secret@:5432/railway',
    })).toBe('')
  })
})
