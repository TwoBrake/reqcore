import { defineConfig } from 'drizzle-kit'
import { resolveDatabaseUrl } from './server/utils/database-url'

/**
 * Resolve a valid database URL, with a fallback for Railway PR/preview environments
 * where DATABASE_URL may have an empty hostname due to unresolved variable references.
 * Falls back to individual PG* and RAILWAY_TCP_PROXY_* variables when available.
 */
const databaseUrl = resolveDatabaseUrl(process.env)
if (!databaseUrl) {
  throw new Error(
    `DATABASE_URL is missing a hostname and no PGHOST fallback is available.\n`
    + `In Railway PR environments, ensure the Postgres service variables are linked to this service.`,
  )
}

export default defineConfig({
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
})
