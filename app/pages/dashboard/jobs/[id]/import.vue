<script setup lang="ts">
import {
  ArrowRight, FileText, Loader2, UploadCloud, X,
} from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const localePath = useLocalePath()
const jobId = route.params.id as string
const { job, status: fetchStatus, error: fetchError } = useJob(jobId)
const { track } = useTrack()

useSeoMeta({
  title: computed(() =>
    job.value ? `Import Candidates - ${job.value.title} - Reqcore` : 'Import Candidates - Reqcore',
  ),
})

interface ImportCreatedResponse {
  job: { id: string }
}

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref<string | null>(null)

function pickFile(selected: File | null | undefined) {
  uploadError.value = null
  if (!selected) return
  if (!selected.name.toLowerCase().endsWith('.csv')) {
    uploadError.value = 'Please choose a .csv file.'
    return
  }
  if (selected.size > 25 * 1024 * 1024) {
    uploadError.value = 'The CSV file must be 25 MB or smaller.'
    return
  }
  file.value = selected
}

function onFileChange(event: Event) {
  pickFile((event.target as HTMLInputElement).files?.[0])
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  pickFile(event.dataTransfer?.files?.[0])
}

function clearFile() {
  file.value = null
  uploadError.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function apiError(error: unknown): string {
  const err = error as { data?: { statusMessage?: string }; statusMessage?: string }
  return err.data?.statusMessage ?? err.statusMessage ?? 'Upload failed. Please check the file and try again.'
}

async function upload() {
  if (!file.value || uploading.value) return
  uploading.value = true
  uploadError.value = null
  try {
    const body = new FormData()
    body.append('file', file.value)
    body.append('jobId', jobId)
    const result = await $fetch<ImportCreatedResponse>('/api/candidates/import', {
      method: 'POST',
      body,
    })
    track('candidate_import_uploaded', {
      source: 'job_import_tab',
      job_id: jobId,
    })
    await navigateTo(localePath(`/dashboard/candidates/import?id=${result.job.id}`))
  }
  catch (error) {
    uploadError.value = apiError(error)
  }
  finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <JobSubNavActions :job-id="jobId" />

    <div v-if="fetchStatus === 'pending'" class="py-12 text-center text-surface-400">
      Loading...
    </div>

    <div
      v-else-if="fetchError"
      class="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-400"
    >
      {{ fetchError.statusCode === 404 ? 'Job not found.' : 'Failed to load job.' }}
      <NuxtLink :to="localePath('/dashboard/jobs')" class="ml-1 underline">Back to Jobs</NuxtLink>
    </div>

    <template v-else-if="job">
      <header class="mb-8">
        <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-50">Import candidates</h1>
        <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          Add candidates to <strong>{{ job.title }}</strong> from a CSV file.
        </p>
      </header>

      <section class="mb-8 rounded-lg border border-surface-200 bg-white p-6 dark:border-surface-800 dark:bg-surface-900">
        <div class="mb-5">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Upload a CSV file</h2>
          <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
            Imported people will be added directly to this job's pipeline.
          </p>
        </div>

        <div
          class="rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-10"
          :class="isDragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
            : 'border-surface-300 dark:border-surface-700'"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
        >
          <template v-if="!file">
            <UploadCloud class="mx-auto size-10 text-surface-400" />
            <p class="mt-3 text-sm text-surface-700 dark:text-surface-300">
              Drag a CSV here, or
              <button type="button" class="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400" @click="fileInput?.click()">
                browse to upload
              </button>
            </p>
            <p class="mt-1 text-xs text-surface-400">CSV up to 25 MB, one candidate per row, with column names in the first row</p>
          </template>

          <div v-else class="flex items-center justify-center gap-3">
            <FileText class="size-8 shrink-0 text-brand-600 dark:text-brand-400" />
            <div class="min-w-0 text-left">
              <p class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{{ file.name }}</p>
              <p class="text-xs text-surface-400">{{ (file.size / 1024).toFixed(0) }} KB</p>
            </div>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800"
              title="Remove file"
              @click="clearFile"
            >
              <X class="size-4" />
            </button>
          </div>

          <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
        </div>

        <p v-if="uploadError" class="mt-3 text-sm text-danger-600 dark:text-danger-400">{{ uploadError }}</p>

        <button
          type="button"
          :disabled="!file || uploading"
          class="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="upload"
        >
          <Loader2 v-if="uploading" class="size-4 animate-spin" />
          {{ uploading ? 'Uploading...' : 'Continue' }}
          <ArrowRight v-if="!uploading" class="size-4" />
        </button>
      </section>
    </template>
  </div>
</template>
