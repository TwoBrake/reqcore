import { eq, and, asc } from 'drizzle-orm'
import { applicationRule, job } from '../../../../database/schema'
import { ruleJobIdParamSchema } from '../../../../utils/schemas/applicationRule'

/**
 * GET /api/jobs/:id/rules
 * List all automation rules for a job, ordered by displayOrder.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, ruleJobIdParamSchema.parse)

  const jobRecord = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  const rules = await db
    .select()
    .from(applicationRule)
    .where(and(
      eq(applicationRule.jobId, jobId),
      eq(applicationRule.organizationId, orgId),
    ))
    .orderBy(asc(applicationRule.displayOrder))

  return { rules }
})
