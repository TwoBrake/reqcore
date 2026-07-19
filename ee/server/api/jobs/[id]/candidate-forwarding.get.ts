import { and, desc, eq } from 'drizzle-orm'
import { candidateForwardingAddress, importJob, job } from '~~/server/database/schema'
import { decrypt } from '~~/server/utils/encryption'
import { summarizeJob } from '~~/server/utils/candidate-import-service'
import { candidateForwardAddress } from '../../../utils/candidate-forwarding'
import { candidateForwardingConfig } from '../../../utils/candidate-forwarding-config'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Job ID is required' })

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) throw createError({ statusCode: 404, statusMessage: 'Job not found' })

  const config = candidateForwardingConfig()
  const forwarding = await db.query.candidateForwardingAddress.findFirst({
    where: and(
      eq(candidateForwardingAddress.jobId, id),
      eq(candidateForwardingAddress.organizationId, orgId),
    ),
  })

  let address: string | null = null
  if (forwarding?.isEnabled && config.domain) {
    const token = decrypt(forwarding.tokenEncrypted, env.BETTER_AUTH_SECRET)
    if (!token) {
      logError('candidate_forwarding.token_decrypt_failed', {
        organization_id: orgId,
        forwarding_address_id: forwarding.id,
      })
    }
    else {
      address = candidateForwardAddress(token, config.domain)
    }
  }

  const imports = await db.select({
    id: importJob.id,
    filename: importJob.filename,
    status: importJob.status,
    createdAt: importJob.createdAt,
  }).from(importJob).where(and(
    eq(importJob.organizationId, orgId),
    eq(importJob.targetJobId, id),
    eq(importJob.source, 'email_forward'),
  )).orderBy(desc(importJob.createdAt)).limit(10)

  const recent = await Promise.all(imports.map(async item => ({
    ...item,
    summary: await summarizeJob(item.id),
  })))

  return {
    available: config.available,
    missing: config.missing,
    enabled: forwarding?.isEnabled ?? false,
    address,
    recent,
  }
})
