import { fileTypeFromBuffer } from 'file-type'
import {
  CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES,
  CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES,
  CANDIDATE_MESSAGE_MAX_ATTACHMENTS,
  CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES,
  type CandidateMessageAttachmentMimeType,
} from '~~/shared/candidate-messaging'
import { sanitizeFilename } from '~~/server/utils/schemas/document'

const EXTENSION_BY_MIME: Record<CandidateMessageAttachmentMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const allowedMimes = new Set<string>(CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES)

export class CandidateMessageAttachmentError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message)
    this.name = 'CandidateMessageAttachmentError'
  }
}

export interface ValidatedCandidateMessageAttachment {
  data: Buffer
  filename: string
  mimeType: CandidateMessageAttachmentMimeType
  extension: string
  sizeBytes: number
}

export async function validateCandidateMessageAttachments(
  files: Array<{ data: Buffer, filename?: string }>,
): Promise<ValidatedCandidateMessageAttachment[]> {
  if (files.length > CANDIDATE_MESSAGE_MAX_ATTACHMENTS) {
    throw new CandidateMessageAttachmentError(
      `Attach at most ${CANDIDATE_MESSAGE_MAX_ATTACHMENTS} files.`,
    )
  }

  const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0)
  if (totalBytes > CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new CandidateMessageAttachmentError('Attachments can be at most 20 MB in total.', 413)
  }

  return Promise.all(files.map(async (file) => {
    if (!file.filename || file.data.length === 0) {
      throw new CandidateMessageAttachmentError('Every attachment must have a filename and content.')
    }
    if (file.data.length > CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES) {
      throw new CandidateMessageAttachmentError(`${sanitizeFilename(file.filename)} is larger than 10 MB.`, 413)
    }

    const detected = await fileTypeFromBuffer(file.data)
    if (!detected || !allowedMimes.has(detected.mime)) {
      throw new CandidateMessageAttachmentError(
        `${sanitizeFilename(file.filename)} is not a supported PDF or image file.`,
        415,
      )
    }

    const mimeType = detected.mime as CandidateMessageAttachmentMimeType
    return {
      data: file.data,
      filename: sanitizeFilename(file.filename),
      mimeType,
      extension: EXTENSION_BY_MIME[mimeType],
      sizeBytes: file.data.length,
    }
  }))
}

export function shouldStoreInboundAttachment(input: {
  contentDisposition?: string | null
  contentId?: string | null
}): boolean {
  return !(input.contentDisposition === 'inline' && input.contentId)
}
