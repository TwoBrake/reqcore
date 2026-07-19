import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { importJob } from '../../../../database/schema'
import { importIdParamSchema } from '../../../../utils/schemas/import'
import { buildPreview, stageRows } from '../../../../utils/candidate-import-service'

const forwardedCandidateSchema = z.object({
  name: z.string().trim().max(200),
  email: z.string().trim().max(255),
  phone: z.string().trim().max(50).default(''),
  notes: z.string().trim().max(1000).default(''),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, importIdParamSchema.parse)
  const body = await readValidatedBody(event, forwardedCandidateSchema.parse)

  const [job] = await db.select().from(importJob).where(and(
    eq(importJob.id, id),
    eq(importJob.organizationId, orgId),
    eq(importJob.source, 'email_forward'),
  ))
  if (!job) throw createError({ statusCode: 404, statusMessage: 'Forwarded candidate import not found' })
  if (job.status !== 'previewing') {
    throw createError({ statusCode: 409, statusMessage: 'This forwarded candidate can no longer be edited' })
  }

  const mapping = {
    'Candidate name': 'fullName',
    'Candidate email': 'email',
    Phone: 'phone',
    Notes: 'quickNotes',
  }
  await stageRows({
    orgId,
    jobId: job.id,
    rows: [{
      'Candidate name': body.name,
      'Candidate email': body.email,
      Phone: body.phone,
      Notes: body.notes,
    }],
    mapping,
  })
  const [updated] = await db.select().from(importJob).where(and(
    eq(importJob.id, id),
    eq(importJob.organizationId, orgId),
  ))
  return buildPreview(updated!)
})
