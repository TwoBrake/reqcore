import type { WebhookEventPayload } from 'resend'
import { fileTypeFromBuffer } from 'file-type'
import { and, eq, sql } from 'drizzle-orm'
import {
  candidateForwardingAddress,
  importAttachment,
  importJob,
  importRow,
  member,
  user,
} from '~~/server/database/schema'
import { getResendReceivingClient } from '~~/server/utils/email'
import { uploadToS3, deleteFromS3 } from '~~/server/utils/s3'
import { parseDocument } from '~~/server/utils/resume-parser'
import { sanitizeFilename, MIME_TO_EXTENSION } from '~~/server/utils/schemas/document'
import { stageRows } from '~~/server/utils/candidate-import-service'
import { normalizeEmailAddress } from './candidate-messaging'
import {
  CANDIDATE_FORWARD_MAX_ATTACHMENTS,
  CANDIDATE_FORWARD_MAX_ATTACHMENT_BYTES,
  CANDIDATE_FORWARD_MAX_TOTAL_ATTACHMENT_BYTES,
  downloadCandidateAttachment,
  extractResumeIdentity,
  findCandidateForwardToken,
  hashCandidateForwardToken,
  mergeCandidateIdentities,
  parseForwardedCandidateIdentity,
} from './candidate-forwarding'

type ReceivedEvent = Extract<WebhookEventPayload, { type: 'email.received' }>

interface ValidatedResume {
  providerAttachmentId: string
  data: Buffer
  filename: string
  mimeType: string
  extension: string
  parsedContent: Record<string, unknown> | null
}

export async function processCandidateForwardingEmail(
  event: ReceivedEvent,
  domain: string,
): Promise<boolean> {
  const token = findCandidateForwardToken(event.data.to, domain)
  if (!token) return false

  const forwarding = await db.query.candidateForwardingAddress.findFirst({
    where: and(
      eq(candidateForwardingAddress.tokenHash, hashCandidateForwardToken(token)),
      eq(candidateForwardingAddress.isEnabled, true),
    ),
  })
  if (!forwarding) {
    logWarn('candidate_forwarding.unknown_or_disabled_token', {
      provider_message_id: event.data.email_id,
    })
    return true
  }

  const senderEmail = normalizeEmailAddress(event.data.from)
  const [sender] = await db.select({ userId: user.id }).from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(
      eq(member.organizationId, forwarding.organizationId),
      sql`lower(${user.email}) = ${senderEmail}`,
    ))
    .limit(1)
  if (!sender) {
    logWarn('candidate_forwarding.unauthorized_sender', {
      organization_id: forwarding.organizationId,
      forwarding_address_id: forwarding.id,
      provider_message_id: event.data.email_id,
    })
    return true
  }

  const resend = getResendReceivingClient()
  if (!resend) throw new Error('Resend Receiving is not configured')
  const { data, error } = await resend.emails.receiving.get(event.data.email_id)
  if (error || !data) throw new Error(error?.message ?? 'Inbound email content was unavailable')

  const resumes = await fetchResumeAttachments(resend, data.id, forwarding.organizationId)
  const forwardedIdentity = parseForwardedCandidateIdentity(data.text, data.html)
  const identity = mergeCandidateIdentities(
    forwardedIdentity,
    resumes.map(resume => extractResumeIdentity(
      typeof resume.parsedContent?.text === 'string' ? resume.parsedContent.text : null,
    )),
  )
  const rawRow = {
    'Candidate name': identity.name,
    'Candidate email': identity.email,
    Phone: '',
    Notes: `Forwarded email: ${(data.subject || event.data.subject || '(No subject)').slice(0, 900)}`,
  }
  const columns = Object.keys(rawRow)
  const mapping = {
    'Candidate name': 'fullName',
    'Candidate email': 'email',
    Phone: 'phone',
    Notes: 'quickNotes',
  }

  const importId = crypto.randomUUID()
  const [created] = await db.insert(importJob).values({
    id: importId,
    organizationId: forwarding.organizationId,
    createdBy: sender.userId,
    source: 'email_forward',
    status: 'processing',
    filename: sanitizeFilename(`Forwarded - ${data.subject || event.data.subject || 'No subject'}`).slice(0, 255),
    providerMessageId: data.id,
    sourceSenderEmail: senderEmail,
    columns,
    mapping,
    targetJobId: forwarding.jobId,
  }).onConflictDoNothing({ target: importJob.providerMessageId }).returning({
    id: importJob.id,
    organizationId: importJob.organizationId,
  })

  const stagedJob = created ?? await db.query.importJob.findFirst({
    where: eq(importJob.providerMessageId, data.id),
    columns: { id: true, organizationId: true },
  })
  if (!stagedJob || stagedJob.organizationId !== forwarding.organizationId) {
    throw new Error('Forwarded email could not be staged')
  }

  const existingRows = await db.select({ id: importRow.id }).from(importRow)
    .where(eq(importRow.jobId, stagedJob.id)).limit(1)
  if (existingRows.length === 0) {
    await stageRows({
      orgId: forwarding.organizationId,
      jobId: stagedJob.id,
      rows: [rawRow],
      mapping,
    })
  }

  for (const resume of resumes) {
    await persistResumeAttachment({
      orgId: forwarding.organizationId,
      importJobId: stagedJob.id,
      resume,
    })
  }

  logInfo('candidate_forwarding.staged', {
    organization_id: forwarding.organizationId,
    job_id: forwarding.jobId,
    import_job_id: stagedJob.id,
    provider_message_id: data.id,
    resume_count: resumes.length,
  })
  return true
}

async function fetchResumeAttachments(
  resend: NonNullable<ReturnType<typeof getResendReceivingClient>>,
  emailId: string,
  orgId: string,
): Promise<ValidatedResume[]> {
  const { data: page, error } = await resend.emails.receiving.attachments.list({ emailId })
  if (error || !page) throw new Error(error?.message ?? 'Inbound attachment metadata was unavailable')

  const candidates = page.data.filter(attachment => {
    if (attachment.content_disposition === 'inline' && attachment.content_id) return false
    const filename = attachment.filename?.toLowerCase() ?? ''
    return filename.endsWith('.pdf') || filename.endsWith('.doc') || filename.endsWith('.docx')
  })
  const resumes: ValidatedResume[] = []
  let totalBytes = 0

  for (const attachment of candidates) {
    if (resumes.length >= CANDIDATE_FORWARD_MAX_ATTACHMENTS) break
    if (attachment.size > CANDIDATE_FORWARD_MAX_ATTACHMENT_BYTES) {
      logWarn('candidate_forwarding.attachment_skipped', { organization_id: orgId, reason: 'file_size_limit' })
      continue
    }
    if (totalBytes + attachment.size > CANDIDATE_FORWARD_MAX_TOTAL_ATTACHMENT_BYTES) {
      logWarn('candidate_forwarding.attachment_skipped', { organization_id: orgId, reason: 'total_size_limit' })
      break
    }

    const fileData = await downloadCandidateAttachment(
      attachment.download_url,
      CANDIDATE_FORWARD_MAX_ATTACHMENT_BYTES,
    )
    const mimeType = await detectResumeMime(fileData)
    const extension = mimeType ? MIME_TO_EXTENSION[mimeType] : undefined
    if (!mimeType || !extension) {
      logWarn('candidate_forwarding.attachment_skipped', { organization_id: orgId, reason: 'unsupported_file_type' })
      continue
    }
    const parsed = await parseDocument(fileData, mimeType)
    resumes.push({
      providerAttachmentId: attachment.id,
      data: fileData,
      filename: sanitizeFilename(attachment.filename || `resume.${extension}`),
      mimeType,
      extension,
      parsedContent: parsed ? { ...parsed } : null,
    })
    totalBytes += fileData.length
  }
  return resumes
}

async function detectResumeMime(data: Buffer): Promise<string | null> {
  const detected = await fileTypeFromBuffer(data)
  let mimeType = detected?.mime
  if (!mimeType || mimeType === 'application/x-cfb') {
    const ole2Magic = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
    if (data.length >= 8 && Buffer.compare(data.subarray(0, 8), ole2Magic) === 0) {
      mimeType = 'application/msword'
    }
  }
  return mimeType && mimeType in MIME_TO_EXTENSION ? mimeType : null
}

async function persistResumeAttachment(input: {
  orgId: string
  importJobId: string
  resume: ValidatedResume
}): Promise<void> {
  const existing = await db.query.importAttachment.findFirst({
    where: eq(importAttachment.providerAttachmentId, input.resume.providerAttachmentId),
    columns: { id: true },
  })
  if (existing) return

  const id = crypto.randomUUID()
  const storageKey = `${input.orgId}/candidate-imports/${input.importJobId}/${id}.${input.resume.extension}`
  await uploadToS3(storageKey, input.resume.data, input.resume.mimeType)
  try {
    const inserted = await db.insert(importAttachment).values({
      id,
      organizationId: input.orgId,
      importJobId: input.importJobId,
      providerAttachmentId: input.resume.providerAttachmentId,
      storageKey,
      filename: input.resume.filename,
      mimeType: input.resume.mimeType,
      sizeBytes: input.resume.data.length,
      parsedContent: input.resume.parsedContent,
    }).onConflictDoNothing({ target: importAttachment.providerAttachmentId }).returning({ id: importAttachment.id })
    if (inserted.length === 0) await deleteFromS3(storageKey)
  }
  catch (error) {
    await deleteFromS3(storageKey).catch(() => undefined)
    throw error
  }
}
