<script setup lang="ts">
import { FileImage, FileText, X } from 'lucide-vue-next'

defineProps<{
  files: File[]
  disabled?: boolean
}>()

defineEmits<{
  remove: [index: number]
}>()
</script>

<template>
  <div v-if="files.length" class="mb-2 flex flex-wrap gap-1.5">
    <span
      v-for="(file, index) in files"
      :key="`${file.name}-${file.size}-${file.lastModified}-${index}`"
      class="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-surface-200 bg-surface-50 px-2 py-1 text-xs text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200"
    >
      <FileImage v-if="file.type.startsWith('image/')" class="size-3.5 shrink-0 text-surface-400" />
      <FileText v-else class="size-3.5 shrink-0 text-surface-400" />
      <span class="max-w-48 truncate">{{ file.name }}</span>
      <button
        type="button"
        class="grid size-5 shrink-0 place-items-center rounded text-surface-400 hover:bg-surface-200 hover:text-surface-700 disabled:opacity-50 dark:hover:bg-surface-700 dark:hover:text-surface-100"
        :disabled="disabled"
        :title="`Remove ${file.name}`"
        @click="$emit('remove', index)"
      >
        <X class="size-3" />
      </button>
    </span>
  </div>
</template>
