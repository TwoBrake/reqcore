import {
  CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES,
  CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES,
  CANDIDATE_MESSAGE_MAX_ATTACHMENTS,
  CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES,
} from '~~/shared/candidate-messaging'

const allowedMimes = new Set<string>(CANDIDATE_MESSAGE_ATTACHMENT_MIME_TYPES)

export function useCandidateMessageAttachments(onChange?: () => void) {
  const toast = useToast()
  const files = ref<File[]>([])

  function add(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const next = [...files.value]

    for (const file of Array.from(input.files ?? [])) {
      if (!allowedMimes.has(file.type)) {
        toast.error('Unsupported attachment', { message: 'Use PDF, JPEG, PNG, GIF, or WebP files.' })
        continue
      }
      if (file.size > CANDIDATE_MESSAGE_MAX_ATTACHMENT_BYTES) {
        toast.error('Attachment too large', { message: `${file.name} is larger than 10 MB.` })
        continue
      }
      if (next.length >= CANDIDATE_MESSAGE_MAX_ATTACHMENTS) {
        toast.error('Too many attachments', { message: `Attach at most ${CANDIDATE_MESSAGE_MAX_ATTACHMENTS} files.` })
        break
      }
      const totalBytes = next.reduce((sum, item) => sum + item.size, 0) + file.size
      if (totalBytes > CANDIDATE_MESSAGE_MAX_TOTAL_ATTACHMENT_BYTES) {
        toast.error('Attachments too large', { message: 'Attachments can be at most 20 MB in total.' })
        break
      }
      next.push(file)
    }

    files.value = next
    input.value = ''
    onChange?.()
  }

  function remove(index: number) {
    files.value.splice(index, 1)
    onChange?.()
  }

  function clear() {
    files.value = []
  }

  return { files, add, remove, clear }
}
