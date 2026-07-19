import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidateForwardingAddress, job } from '~~/server/database/schema'
import { decrypt, encrypt } from '~~/server/utils/encryption'
import {
  candidateForwardAddress,
  createCandidateForwardToken,
  hashCandidateForwardToken,
} from '../../../utils/candidate-forwarding'
import { requireCandidateForwardingConfig } from '../../../utils/candidate-forwarding-config'

const actionSchema = z.object({ action: z.enum(['enable', 'disable', 'rotate']) })

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  assertEmailVerified(session.user)
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Job ID is required' })
  const { action } = await readValidatedBody(event, actionSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) throw createError({ statusCode: 404, statusMessage: 'Job not found' })

  const existing = await db.query.candidateForwardingAddress.findFirst({
    where: and(
      eq(candidateForwardingAddress.jobId, id),
      eq(candidateForwardingAddress.organizationId, orgId),
    ),
  })

  if (action === 'disable') {
    if (existing) {
      await db.update(candidateForwardingAddress).set({ isEnabled: false, updatedAt: new Date() })
        .where(and(
          eq(candidateForwardingAddress.id, existing.id),
          eq(candidateForwardingAddress.organizationId, orgId),
        ))
    }
    recordActivity({
      organizationId: orgId,
      actorId: session.user.id,
      action: 'updated',
      resourceType: 'job',
      resourceId: id,
      metadata: { candidateForwarding: 'disabled' },
    })
    return { enabled: false, address: null }
  }

  const { domain } = requireCandidateForwardingConfig()
  let token: string
  if (action === 'enable' && existing) {
    token = decrypt(existing.tokenEncrypted, env.BETTER_AUTH_SECRET) ?? createCandidateForwardToken()
  }
  else {
    token = createCandidateForwardToken()
  }

  const tokenHash = hashCandidateForwardToken(token)
  const tokenEncrypted = encrypt(token, env.BETTER_AUTH_SECRET)
  await db.insert(candidateForwardingAddress).values({
    organizationId: orgId,
    jobId: id,
    tokenHash,
    tokenEncrypted,
    isEnabled: true,
    createdBy: session.user.id,
  }).onConflictDoUpdate({
    target: candidateForwardingAddress.jobId,
    set: { tokenHash, tokenEncrypted, isEnabled: true, updatedAt: new Date() },
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'updated',
    resourceType: 'job',
    resourceId: id,
    metadata: { candidateForwarding: action === 'rotate' ? 'rotated' : 'enabled' },
  })

  return { enabled: true, address: candidateForwardAddress(token, domain) }
})
