import { and, eq } from 'drizzle-orm'
import { importJob } from '../../../../database/schema'
import { importIdParamSchema, commitImportSchema } from '../../../../utils/schemas/import'
import { commitImport, buildPreview } from '../../../../utils/candidate-import-service'

/**
 * POST /api/candidates/import/:id/commit
 *
 * Write the job's ready rows to `candidate`, applying the chosen duplicate
 * policy (skip existing, or update them). Idempotent and resumable, so a job
 * left in `committing` (e.g. after a crash) can be re-posted to finish.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, importIdParamSchema.parse)
  const { duplicatePolicy } = await readValidatedBody(event, commitImportSchema.parse)

  const [job] = await db.select().from(importJob)
    .where(and(eq(importJob.id, id), eq(importJob.organizationId, orgId)))
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Import job not found' })
  }
  if (job.status === 'completed') {
    throw createError({ statusCode: 409, statusMessage: 'This import has already been committed.' })
  }
  if (job.status !== 'previewing' && job.status !== 'committing') {
    throw createError({ statusCode: 409, statusMessage: `Cannot commit a job that is ${job.status}.` })
  }

  const result = await commitImport({
    orgId,
    jobId: job.id,
    duplicatePolicy,
    targetJobId: job.targetJobId,
  })

  // One lean, job-level audit entry rather than one per created candidate.
  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'import_job',
    resourceId: job.id,
    metadata: {
      filename: job.filename,
      targetJobId: job.targetJobId,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      applied: result.applied,
    },
  })

  trackEvent(event, session, 'candidate import committed', {
    import_job_id: job.id,
    duplicate_policy: duplicatePolicy,
    target_job_id: job.targetJobId,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    applied: result.applied,
  })
  logApiRequest(event, session, 'candidate_import.committed', {
    import_job_id: job.id,
    created: result.created,
    updated: result.updated,
    skipped: result.skipped,
    applied: result.applied,
  })

  const [committed] = await db.select().from(importJob).where(eq(importJob.id, job.id))
  return { result, preview: await buildPreview(committed!) }
})
