export interface DatabaseUrlEnvironment {
  readonly [key: string]: string | undefined
  readonly DATABASE_URL?: string
  readonly PGHOST?: string
  readonly PGPORT?: string
  readonly PGUSER?: string
  readonly PGPASSWORD?: string
  readonly PGDATABASE?: string
  readonly RAILWAY_TCP_PROXY_DOMAIN?: string
  readonly RAILWAY_TCP_PROXY_PORT?: string
}

function value(source: DatabaseUrlEnvironment, key: keyof DatabaseUrlEnvironment): string {
  return source[key]?.trim() ?? ''
}

/**
 * Resolve the database URL used by Railway preview environments.
 *
 * A preview can inherit a DATABASE_URL whose referenced host is empty. Railway
 * still exposes the individual PG/proxy variables, so reconstruct a usable URL
 * from those values. An empty result lets the caller produce its own contextual
 * configuration error without logging a connection string containing secrets.
 */
export function resolveDatabaseUrl(source: DatabaseUrlEnvironment): string {
  const raw = value(source, 'DATABASE_URL')

  try {
    if (new URL(raw).hostname) return raw
  }
  catch {
    // Fall through to Railway's individual connection variables.
  }

  const host = value(source, 'PGHOST') || value(source, 'RAILWAY_TCP_PROXY_DOMAIN')
  if (!host) return ''

  const port = value(source, 'PGPORT') || value(source, 'RAILWAY_TCP_PROXY_PORT') || '5432'
  const user = value(source, 'PGUSER') || 'postgres'
  const password = value(source, 'PGPASSWORD')
  const database = value(source, 'PGDATABASE') || 'railway'

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`
}
