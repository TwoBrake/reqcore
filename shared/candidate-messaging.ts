export const CANDIDATE_MESSAGE_MAX_ATTACHMENTS = 5
export const CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * Upper bound on the whole multipart request body, checked from the
 * Content-Length header before the body is buffered into memory. Sits above the
 * 20 MB attachment total to leave headroom for the text fields and multipart
 * framing overhead, so a valid send is never rejected by this guard.
 */
export const CANDIDATE_MESSAGE_MAX_REQUEST_BYTES = CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES + 1024 * 1024

export const CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

export type CandidateMessageAttachmentMimeType = typeof CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES[number]

export const CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT = CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES.join(',')

export interface CandidateMessageAttachmentInfo {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
}
