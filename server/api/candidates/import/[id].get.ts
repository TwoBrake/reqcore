import { and, eq } from 'drizzle-orm'
import { importJob } from '../../../database/schema'
import { importIdParamSchema } from '../../../utils/schemas/import'
import { buildPreview } from '../../../utils/candidate-import-service'

/**
 * GET /api/candidates/import/:id
 *
 * Fetch an import job with its current preview (counts + sample rows). Used to
 * render the review screen and to poll progress during commit.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, importIdParamSchema.parse)

  const [job] = await db.select().from(importJob)
    .where(and(eq(importJob.id, id), eq(importJob.organizationId, orgId)))
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Import job not found' })
  }

  return buildPreview(job)
})
