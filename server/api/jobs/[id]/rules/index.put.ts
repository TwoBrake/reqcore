import { eq, and, asc } from 'drizzle-orm'
import { applicationRule, job } from '../../../../database/schema'
import { bulkRulesSchema, ruleJobIdParamSchema } from '../../../../utils/schemas/applicationRule'

/**
 * PUT /api/jobs/:id/rules
 * Replace the full automation-rule set for a job (atomic save from the builder).
 * displayOrder is derived from array position.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId } = await getValidatedRouterParams(event, ruleJobIdParamSchema.parse)
  const body = await readValidatedBody(event, bulkRulesSchema.parse)

  const jobRecord = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!jobRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }

  const saved = await db.transaction(async (tx) => {
    await tx.delete(applicationRule)
      .where(and(
        eq(applicationRule.jobId, jobId),
        eq(applicationRule.organizationId, orgId),
      ))

    if (body.rules.length === 0) return []

    return tx.insert(applicationRule)
      .values(body.rules.map((r, index) => ({
        organizationId: orgId,
        jobId,
        name: r.name,
        matchType: r.matchType,
        action: r.action,
        enabled: r.enabled,
        conditions: r.conditions,
        displayOrder: index,
      })))
      .returning()
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'applicationRules',
    resourceId: jobId,
    metadata: { count: saved.length },
  })

  logApiRequest(event, session, 'application_rules.saved', {
    job_id: jobId,
    rule_count: saved.length,
  })

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
