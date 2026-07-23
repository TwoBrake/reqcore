import { eq, and } from 'drizzle-orm'
import { application, applicationRule, job } from '../../../../database/schema'
import { ruleJobIdParamSchema } from '../../../../utils/schemas/applicationRule'
import { applyRulesToApplication } from '../../../../utils/rules/applyRules'

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

  const enabledCount = await db.$count(
    applicationRule,
    and(
      eq(applicationRule.jobId, jobId),
      eq(applicationRule.organizationId, orgId),
      eq(applicationRule.enabled, true),
    ),
  )
  if (enabledCount === 0) {
    return { evaluated: 0, matched: 0, byAction: {} as Record<string, number> }
  }

  const newApps = await db
    .select({ id: application.id })
    .from(application)
    .where(and(
      eq(application.jobId, jobId),
      eq(application.organizationId, orgId),
      eq(application.status, 'new'),
    ))

  const byAction: Record<string, number> = {}
  let matched = 0
  for (const app of newApps) {
    const result = await applyRulesToApplication(app.id, orgId)
    if (result) {
      matched++
      byAction[result.action] = (byAction[result.action] ?? 0) + 1
    }
  }

  logApiRequest(event, session, 'application_rules.run', {
    job_id: jobId,
    evaluated: newApps.length,
    matched,
  })

  return { evaluated: newApps.length, matched, byAction }
})
