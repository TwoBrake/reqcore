import { eq, and } from 'drizzle-orm'
import { job } from '../../../../database/schema'
import { ruleJobIdParamSchema } from '../../../../utils/schemas/applicationRule'
import { applyRulesToNewJobApplications } from '../../../../utils/rules/applyRules'

/**
 * POST /api/jobs/:id/rules/run
 * Retroactively evaluate the current rule set against every application still in
 * `new` for this job. Useful right after editing rules to catch applicants who
 * came in before the rule existed. Only `new` applications are touched.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, ruleJobIdParamSchema.parse)

  const jobRecord = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  const result = await applyRulesToNewJobApplications(jobId, orgId)

  logApiRequest(event, session, 'application_rules.run', {
    job_id: jobId,
    evaluated: result.evaluated,
    matched: result.matched,
  })

  return result
})
