import { z } from 'zod'

export const candidateMessageIdParamSchema = z.object({
  id: z.string().uuid(),
})

export const sendCandidateMessageSchema = z.object({
  applicationId: z.string().uuid(),
  requestId: z.string().uuid(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
})

export const candidateInboxQuerySchema = z.object({
  applicationId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  unread: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
