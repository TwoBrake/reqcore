import type { PropertyEntry } from './properties'

export interface CandidateDetail {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
  email: string
  phone: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  dateOfBirth: string | null
  quickNotes: string | null
  createdAt: string
  updatedAt: string
  applications: Array<{
    id: string
    status: 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'
    createdAt: string
    job: { id: string; title: string }
  }>
  documents: Array<{
    id: string
    type: 'resume' | 'cover_letter' | 'other'
    originalFilename: string
    mimeType: string
    createdAt: string
    parsed: boolean
  }>
  properties: PropertyEntry[]
  retention:
    | { enabled: false }
    | {
        enabled: true
        status: 'active' | 'expiring' | 'expired' | 'exempt'
        expiresAt: string
        quarantinedAt: string | null
        scheduledPurgeAt: string | null
      }
}
