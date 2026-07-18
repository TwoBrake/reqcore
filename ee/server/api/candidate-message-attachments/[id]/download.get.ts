import { GetObjectCommand } from '@aws-sdk/client-s3'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { candidateMessageAttachment } from '~~/server/database/schema'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidateMessage: ['read'] })
  const orgId = session.session.activeOrganizationId
  await assertPlanFeature(orgId, 'candidateMessaging')
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse)

  const attachment = await db.query.candidateMessageAttachment.findFirst({
    where: and(
      eq(candidateMessageAttachment.id, id),
      eq(candidateMessageAttachment.organizationId, orgId),
    ),
    columns: { storageKey: true, filename: true, mimeType: true },
  })
  if (!attachment) throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: attachment.storageKey,
  }))
  if (!response.Body) throw createError({ statusCode: 500, statusMessage: 'Failed to retrieve attachment' })

  const encodedFilename = encodeURIComponent(attachment.filename)
  const headers: Record<string, string> = {
    'Content-Type': attachment.mimeType,
    'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (response.ContentLength) headers['Content-Length'] = String(response.ContentLength)
  setResponseHeaders(event, headers)

  return response.Body.transformToWebStream()
})
