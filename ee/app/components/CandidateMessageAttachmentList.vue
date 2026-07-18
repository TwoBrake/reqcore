<script setup lang="ts">
import { Download, FileImage, FileText, ShieldAlert } from 'lucide-vue-next'
import type { CandidateMessageAttachmentInfo } from '~~/shared/candidate-messaging'

defineProps<{
  attachments: CandidateMessageAttachmentInfo[]
  outbound?: boolean
}>()

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
</script>

<template>
  <div v-if="attachments.length" class="mt-1.5 max-w-[88%] sm:max-w-[76%]">
    <div class="flex flex-wrap gap-1.5">
      <a
        v-for="attachment in attachments"
        :key="attachment.id"
        :href="`/api/candidate-message-attachments/${attachment.id}/download`"
        download
        rel="noopener noreferrer"
        class="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors"
        :class="outbound
          ? 'border-brand-500 bg-brand-600 text-white hover:bg-brand-700 dark:border-brand-400 dark:bg-brand-500 dark:hover:bg-brand-600'
          : 'border-surface-200 bg-white text-surface-700 hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200 dark:hover:bg-surface-800'"
        :title="`Download ${attachment.filename}`"
      >
        <FileImage v-if="attachment.mimeType.startsWith('image/')" class="size-4 shrink-0" />
        <FileText v-else class="size-4 shrink-0" />
        <span class="min-w-0 truncate">{{ attachment.filename }}</span>
        <span class="shrink-0 opacity-70">{{ formatSize(attachment.sizeBytes) }}</span>
        <Download class="size-3.5 shrink-0 opacity-70" />
      </a>
    </div>
    <p
      v-if="!outbound"
      class="mt-1 flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500"
    >
      <ShieldAlert class="size-3 shrink-0" />
      Candidate-provided attachment.
    </p>
  </div>
</template>
