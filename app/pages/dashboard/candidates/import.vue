<script setup lang="ts">
import {
  ArrowLeft, UploadCloud, FileText, X, ArrowRight, CheckCircle2,
  AlertTriangle, XCircle, Copy, Loader2, PartyPopper, Briefcase,
  Mail, Paperclip, Save,
} from 'lucide-vue-next'
import type { PropertyDefinition } from '~~/shared/properties'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Import Candidates — Reqcore',
  description: 'Import candidates from a CSV file or a forwarded email',
})

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { track } = useTrack()

// ── Types (mirror the /api/candidates/import preview payload) ──────────────────

type ImportField =
  | 'firstName' | 'lastName' | 'fullName' | 'displayName'
  | 'email' | 'phone' | 'gender' | 'dateOfBirth' | 'quickNotes'

type ImportablePropertyType =
  | 'text' | 'long_text' | 'number' | 'select' | 'multi_select'
  | 'date' | 'checkbox' | 'url' | 'email'

type MappingTarget = ImportField | `prop:${string}` | '__new_property__' | ''

type RowStatus =
  | 'ready' | 'duplicate' | 'duplicate_in_file' | 'error' | 'committed' | 'skipped'

interface ImportSummary {
  total: number
  ready: number
  duplicate: number
  duplicateInFile: number
  error: number
  committed: number
  skipped: number
}

interface SampleRow {
  id: string
  rowIndex: number
  status: RowStatus
  rawData: Record<string, string> | null
  normalizedData: {
    firstName: string; lastName: string; displayName: string | null
    email: string; phone: string | null
  } | null
  errorMessage: string | null
  matchedCandidateId: string | null
}

interface ImportPreview {
  job: {
    id: string
    source: string
    status: string
    filename: string | null
    columns: string[]
    mapping: Record<string, string>
    targetJobId: string | null
    totalRows: number
    committedRows: number
    errorMessage: string | null
    createdAt: string
  }
  targetJob: { id: string; title: string } | null
  candidateProperties: PropertyDefinition[]
  propertyTypeSuggestions: Record<string, ImportablePropertyType>
  summary: ImportSummary
  sampleRows: SampleRow[]
  attachments: Array<{
    id: string
    filename: string
    mimeType: string
    sizeBytes: number
    documentId: string | null
  }>
}

interface CommitResponse {
  result: { created: number; updated: number; skipped: number; applied: number; documents: number }
  preview: ImportPreview
}

// ── The candidate fields a column can map onto ────────────────────────────────

const FIELD_OPTIONS: { value: ImportField; label: string; hint?: string }[] = [
  { value: 'email', label: 'Email', hint: 'required' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'fullName', label: 'Full name', hint: 'split into first + last' },
  { value: 'displayName', label: 'Display name' },
  { value: 'phone', label: 'Phone' },
  { value: 'gender', label: 'Gender' },
  { value: 'dateOfBirth', label: 'Date of birth' },
  { value: 'quickNotes', label: 'Quick notes' },
]

const IGNORE = '' as const
const NEW_PROPERTY = '__new_property__' as const
const PROPERTY_TYPE_OPTIONS: { value: ImportablePropertyType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
  { value: 'email', label: 'Email' },
]

// ── Wizard state ──────────────────────────────────────────────────────────────

type Step = 'upload' | 'map' | 'review' | 'done'
const step = ref<Step>('upload')

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'map', label: 'Map columns' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
]
const stepIndex = computed(() => STEPS.findIndex(s => s.key === step.value))

const preview = ref<ImportPreview | null>(null)
const forwardedDraft = ref({ name: '', email: '', phone: '', notes: '' })
// Editable column → field map. '' means the column is ignored.
const mapping = ref<Record<string, MappingTarget>>({})
const newPropertyDrafts = ref<Record<string, { name: string; type: ImportablePropertyType }>>({})
const duplicatePolicy = ref<'skip' | 'update'>('skip')
const commitResult = ref<CommitResponse['result'] | null>(null)

function applyPreview(p: ImportPreview) {
  preview.value = p
  const next: Record<string, MappingTarget> = {}
  for (const col of p.job.columns) {
    next[col] = (p.job.mapping[col] as MappingTarget | undefined) ?? IGNORE
  }
  mapping.value = next
  newPropertyDrafts.value = {}
  if (p.job.source === 'email_forward') {
    const raw = p.sampleRows[0]?.rawData
    forwardedDraft.value = {
      name: raw?.['Candidate name'] ?? '',
      email: raw?.['Candidate email'] ?? '',
      phone: raw?.Phone ?? '',
      notes: raw?.Notes ?? '',
    }
  }
}

function apiError(err: unknown, fallback: string): string {
  const e = err as { data?: { statusMessage?: string }; statusMessage?: string }
  return e?.data?.statusMessage ?? e?.statusMessage ?? fallback
}

// ── Step 1 · Upload ───────────────────────────────────────────────────────────

const file = ref<File | null>(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// Optional target job — "import these people as applicants to role X".
const selectedJobId = ref<string>('')
const { data: jobsData } = await useFetch('/api/jobs', {
  query: { limit: 100 },
  headers: useRequestHeaders(['cookie']),
})
const jobOptions = computed(() =>
  (jobsData.value?.data ?? []).map(j => ({ id: j.id, title: j.title, status: j.status })),
)

const requestedImportId = typeof route.query.id === 'string' ? route.query.id : ''
if (requestedImportId) {
  const { data: requestedPreview, error: requestedError } = await useFetch<ImportPreview>(
    `/api/candidates/import/${requestedImportId}`,
    { headers: useRequestHeaders(['cookie']), key: `candidate-import-${requestedImportId}` },
  )
  if (requestedPreview.value) {
    applyPreview(requestedPreview.value)
    step.value = requestedPreview.value.job.source === 'email_forward' ? 'review' : 'map'
  }
  else if (requestedError.value) {
    uploadError.value = apiError(requestedError.value, 'Could not load this candidate import.')
  }
}

function pickFile(f: File | null | undefined) {
  uploadError.value = null
  if (!f) return
  if (!f.name.toLowerCase().endsWith('.csv')) {
    uploadError.value = 'Please choose a .csv file.'
    return
  }
  file.value = f
}

function onFileChange(e: Event) {
  pickFile((e.target as HTMLInputElement).files?.[0])
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  pickFile(e.dataTransfer?.files?.[0])
}

function clearFile() {
  file.value = null
  uploadError.value = null
  if (fileInput.value) fileInput.value.value = ''
}

async function upload() {
  if (!file.value || uploading.value) return
  uploading.value = true
  uploadError.value = null
  try {
    const body = new FormData()
    body.append('file', file.value)
    if (selectedJobId.value) body.append('jobId', selectedJobId.value)
    const result = await $fetch<ImportPreview>('/api/candidates/import', {
      method: 'POST',
      body,
    })
    applyPreview(result)
    track('candidate_import_uploaded', {
      total_rows: result.summary.total,
      has_target_job: !!selectedJobId.value,
    })
    step.value = 'map'
  } catch (err) {
    uploadError.value = apiError(err, 'Upload failed. Please check the file and try again.')
  } finally {
    uploading.value = false
  }
}

// ── Step 2 · Map columns ──────────────────────────────────────────────────────

const savingMapping = ref(false)

function onMappingChange(column: string) {
  if (mapping.value[column] !== NEW_PROPERTY || newPropertyDrafts.value[column]) return
  newPropertyDrafts.value[column] = {
    name: column.trim().slice(0, 80),
    type: preview.value?.propertyTypeSuggestions[column] ?? 'text',
  }
}

function toggleNewProperty(column: string) {
  mapping.value[column] = mapping.value[column] === NEW_PROPERTY ? IGNORE : NEW_PROPERTY
  onMappingChange(column)
}

/** Up to 3 non-empty example values for a source column, from the sample rows. */
function samplesFor(col: string): string {
  const out: string[] = []
  for (const row of preview.value?.sampleRows ?? []) {
    const v = row.rawData?.[col]
    if (v != null && String(v).trim() !== '') {
      out.push(String(v).trim())
      if (out.length >= 3) break
    }
  }
  return out.join('  ·  ')
}

const emailMapped = computed(() =>
  Object.values(mapping.value).includes('email'),
)

const mappingValid = computed(() => {
  const targets = Object.values(mapping.value).filter(target => target && target !== NEW_PROPERTY)
  const draftsValid = Object.entries(mapping.value).every(([column, target]) => (
    target !== NEW_PROPERTY || !!newPropertyDrafts.value[column]?.name.trim()
  ))
  return draftsValid && new Set(targets).size === targets.length
})

function targetUsedByOtherColumn(target: string, column: string): boolean {
  return target !== NEW_PROPERTY && Object.entries(mapping.value).some(([otherColumn, value]) => (
    otherColumn !== column && value === target
  ))
}

async function confirmMapping() {
  if (savingMapping.value || !preview.value) return
  savingMapping.value = true
  try {
    // Send only the mapped (non-ignored) columns.
    const payload: Record<string, string> = {}
    const newProperties: { column: string; name: string; type: ImportablePropertyType }[] = []
    for (const [col, field] of Object.entries(mapping.value)) {
      if (field === NEW_PROPERTY) {
        const draft = newPropertyDrafts.value[col]
        if (draft) newProperties.push({ column: col, name: draft.name.trim(), type: draft.type })
      }
      else if (field) payload[col] = field
    }
    const result = await $fetch<ImportPreview>(
      `/api/candidates/import/${preview.value.job.id}/mapping`,
      { method: 'PUT', body: { mapping: payload, newProperties } },
    )
    applyPreview(result)
    step.value = 'review'
  } catch (err) {
    toast.error('Could not apply mapping', { message: apiError(err, 'Please try again.') })
  } finally {
    savingMapping.value = false
  }
}

// ── Step 3 · Review + commit ──────────────────────────────────────────────────

const committing = ref(false)
const savingForwarded = ref(false)

const summary = computed(() => preview.value?.summary ?? null)
const targetJob = computed(() => preview.value?.targetJob ?? null)
const isEmailForward = computed(() => preview.value?.job.source === 'email_forward')
const noun = computed(() => (targetJob.value ? 'applicant' : 'candidate'))
const forwardedDirty = computed(() => {
  if (!isEmailForward.value) return false
  const raw = preview.value?.sampleRows[0]?.rawData
  return forwardedDraft.value.name !== (raw?.['Candidate name'] ?? '')
    || forwardedDraft.value.email !== (raw?.['Candidate email'] ?? '')
    || forwardedDraft.value.phone !== (raw?.Phone ?? '')
    || forwardedDraft.value.notes !== (raw?.Notes ?? '')
})

/** How many candidates the commit will write, given the chosen policy. */
const willImport = computed(() => {
  const s = summary.value
  if (!s) return 0
  return s.ready + (duplicatePolicy.value === 'update' || !!targetJob.value ? s.duplicate : 0)
})

async function saveForwardedCandidate(): Promise<boolean> {
  if (!preview.value || !isEmailForward.value || savingForwarded.value) return false
  savingForwarded.value = true
  try {
    const result = await $fetch<ImportPreview>(`/api/candidates/import/${preview.value.job.id}/row`, {
      method: 'PATCH',
      body: forwardedDraft.value,
    })
    applyPreview(result)
    toast.success('Candidate details updated')
    return true
  }
  catch (err) {
    toast.error('Could not update candidate', { message: apiError(err, 'Please check the fields and try again.') })
    return false
  }
  finally {
    savingForwarded.value = false
  }
}

function leaveReview() {
  if (isEmailForward.value && targetJob.value) {
    navigateTo(localePath(`/dashboard/jobs/${targetJob.value.id}/import`))
    return
  }
  step.value = 'map'
}

async function commit() {
  if (committing.value || !preview.value) return
  if (forwardedDirty.value) {
    const saved = await saveForwardedCandidate()
    if (!saved || willImport.value === 0) return
  }
  committing.value = true
  try {
    const res = await $fetch<CommitResponse>(
      `/api/candidates/import/${preview.value.job.id}/commit`,
      { method: 'POST', body: { duplicatePolicy: duplicatePolicy.value } },
    )
    commitResult.value = res.result
    preview.value = res.preview
    track('candidate_import_committed', {
      created: res.result.created,
      updated: res.result.updated,
      skipped: res.result.skipped,
    })
    step.value = 'done'
  } catch (err) {
    toast.error('Import failed', { message: apiError(err, 'Please try again.') })
  } finally {
    committing.value = false
  }
}

// ── Row status presentation ───────────────────────────────────────────────────

const STATUS_META: Record<RowStatus, { label: string; classes: string; icon: unknown }> = {
  ready: { label: 'Ready', classes: 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400', icon: CheckCircle2 },
  duplicate: { label: 'Existing candidate', classes: 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400', icon: Copy },
  duplicate_in_file: { label: 'Duplicate in file', classes: 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400', icon: Copy },
  error: { label: 'Error', classes: 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400', icon: XCircle },
  committed: { label: 'Imported', classes: 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400', icon: CheckCircle2 },
  skipped: { label: 'Skipped', classes: 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400', icon: X },
}

function rowName(row: SampleRow): string {
  const n = row.normalizedData
  if (!n) return '—'
  if (n.displayName) return n.displayName
  const full = `${n.firstName} ${n.lastName}`.trim()
  return full || '—'
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <!-- Back link -->
    <NuxtLink
      :to="targetJob
        ? localePath(`/dashboard/jobs/${targetJob.id}/import`)
        : localePath('/dashboard/candidates')"
      class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-6 transition-colors"
    >
      <ArrowLeft class="size-4" />
      {{ targetJob ? 'Back to job imports' : 'Back to Candidates' }}
    </NuxtLink>

    <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">Import Candidates</h1>

    <!-- Step indicator -->
    <nav class="mb-8 flex items-center gap-2" aria-label="Progress">
      <template v-for="(s, i) in STEPS" :key="s.key">
        <div class="flex items-center gap-2">
          <span
            class="inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors"
            :class="i < stepIndex
              ? 'bg-brand-600 text-white'
              : i === stepIndex
                ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500 dark:bg-brand-950 dark:text-brand-300'
                : 'bg-surface-100 text-surface-400 dark:bg-surface-800'"
          >
            <CheckCircle2 v-if="i < stepIndex" class="size-4" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span
            class="text-sm font-medium"
            :class="i === stepIndex ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 dark:text-surface-500'"
          >{{ s.label }}</span>
        </div>
        <div v-if="i < STEPS.length - 1" class="h-px w-6 flex-none bg-surface-200 dark:bg-surface-800" />
      </template>
    </nav>

    <!-- ── Step 1 · Upload ── -->
    <section v-if="step === 'upload'">
      <div
        class="rounded-xl border-2 border-dashed p-10 text-center transition-colors"
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
            <button type="button" class="font-medium text-brand-600 hover:text-brand-700" @click="fileInput?.click()">
              browse to upload
            </button>
          </p>
          <p class="mt-1 text-xs text-surface-400">CSV up to 25 MB · one candidate per row · a header row with column names</p>
        </template>

        <div v-else class="flex items-center justify-center gap-3">
          <FileText class="size-8 text-brand-600" />
          <div class="text-left">
            <p class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ file.name }}</p>
            <p class="text-xs text-surface-400">{{ (file.size / 1024).toFixed(0) }} KB</p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 transition-colors"
            @click="clearFile"
          >
            <X class="size-4" />
          </button>
        </div>

        <input ref="fileInput" type="file" accept=".csv,text/csv" class="hidden" @change="onFileChange" />
      </div>

      <p v-if="uploadError" class="mt-3 text-sm text-danger-600 dark:text-danger-400">{{ uploadError }}</p>

      <!-- Optional target job -->
      <div class="mt-6">
        <label for="target-job" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
          Add these people as applicants to a job?
          <span class="ml-1 text-xs font-normal text-surface-400">(optional)</span>
        </label>
        <select
          id="target-job"
          v-model="selectedJobId"
          class="w-full sm:max-w-md rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
        >
          <option value="">Just add them to the candidate pool</option>
          <option v-for="j in jobOptions" :key="j.id" :value="j.id">
            {{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}
          </option>
        </select>
        <p class="mt-1 text-xs text-surface-400">
          Applicants land in the job's pipeline, ready to be scored and shortlisted. Pool-only candidates aren't tied to a role.
        </p>
      </div>

      <div class="mt-6 flex items-center gap-3">
        <button
          type="button"
          :disabled="!file || uploading"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="upload"
        >
          <Loader2 v-if="uploading" class="size-4 animate-spin" />
          {{ uploading ? 'Uploading…' : 'Continue' }}
          <ArrowRight v-if="!uploading" class="size-4" />
        </button>
      </div>
    </section>

    <!-- ── Step 2 · Map columns ── -->
    <section v-else-if="step === 'map' && preview">
      <p class="mb-4 text-sm text-surface-600 dark:text-surface-400">
        We matched your columns to candidate fields. You can also keep extra data in an existing or new
        candidate property. Set a column to <span class="font-medium">Ignore</span> to leave it out.
      </p>

      <div
        v-if="!emailMapped"
        class="mb-4 flex items-start gap-2 rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950 p-3 text-sm text-warning-700 dark:text-warning-400"
      >
        <AlertTriangle class="mt-0.5 size-4 flex-none" />
        <span>No column is mapped to <span class="font-medium">Email</span>. Email is required — rows without one can't be imported.</span>
      </div>

      <div class="overflow-x-auto rounded-xl border border-surface-200 dark:border-surface-800">
        <table class="w-full min-w-[48rem] text-sm">
          <thead class="bg-surface-50 dark:bg-surface-900 text-left text-xs font-medium uppercase tracking-wide text-surface-500">
            <tr>
              <th class="px-4 py-2.5">Column in file</th>
              <th class="px-4 py-2.5">Sample values</th>
              <th class="px-4 py-2.5">Maps to</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr v-for="col in preview.job.columns" :key="col">
              <td class="px-4 py-2.5 font-medium text-surface-900 dark:text-surface-100">{{ col }}</td>
              <td class="px-4 py-2.5 text-surface-500 dark:text-surface-400 truncate max-w-xs">{{ samplesFor(col) || '—' }}</td>
              <td class="px-4 py-2.5">
                <select
                  v-model="mapping[col]"
                  class="w-64 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  @change="onMappingChange(col)"
                >
                  <option :value="IGNORE">— Ignore —</option>
                  <optgroup label="Candidate fields">
                    <option
                      v-for="f in FIELD_OPTIONS"
                      :key="f.value"
                      :value="f.value"
                      :disabled="targetUsedByOtherColumn(f.value, col)"
                    >
                      {{ f.label }}{{ f.hint ? ` (${f.hint})` : '' }}
                    </option>
                  </optgroup>
                  <optgroup v-if="preview.candidateProperties.length" label="Candidate properties">
                    <option
                      v-for="property in preview.candidateProperties"
                      :key="property.id"
                      :value="`prop:${property.id}`"
                      :disabled="targetUsedByOtherColumn(`prop:${property.id}`, col)"
                    >
                      {{ property.name }} ({{ PROPERTY_TYPE_OPTIONS.find(option => option.value === property.type)?.label ?? property.type }})
                    </option>
                  </optgroup>
                  <optgroup label="New property">
                    <option :value="NEW_PROPERTY">Create new property…</option>
                  </optgroup>
                </select>
                <label
                  v-if="mapping[col] === IGNORE || mapping[col] === NEW_PROPERTY"
                  class="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-surface-600 dark:text-surface-400"
                >
                  <input
                    type="checkbox"
                    class="size-4 rounded border-surface-300 accent-brand-600 dark:border-surface-700"
                    :checked="mapping[col] === NEW_PROPERTY"
                    @change="toggleNewProperty(col)"
                  />
                  Create a custom property for this column
                </label>
                <div v-if="mapping[col] === NEW_PROPERTY" class="mt-2 grid w-64 grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                  <input
                    v-model="newPropertyDrafts[col]!.name"
                    type="text"
                    maxlength="80"
                    :aria-label="`Property name for ${col}`"
                    class="min-w-0 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <select
                    v-model="newPropertyDrafts[col]!.type"
                    :aria-label="`Property type for ${col}`"
                    class="rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-2 py-1.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option v-for="type in PROPERTY_TYPE_OPTIONS" :key="type.value" :value="type.value">
                      {{ type.label }}
                    </option>
                  </select>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex items-center gap-3">
        <button
          type="button"
          :disabled="savingMapping || !mappingValid"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="confirmMapping"
        >
          <Loader2 v-if="savingMapping" class="size-4 animate-spin" />
          {{ savingMapping ? 'Applying…' : 'Review import' }}
          <ArrowRight v-if="!savingMapping" class="size-4" />
        </button>
        <button
          type="button"
          class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          @click="step = 'upload'"
        >
          Back
        </button>
      </div>
    </section>

    <!-- ── Step 3 · Review ── -->
    <section v-else-if="step === 'review' && preview && summary">
      <div
        v-if="isEmailForward"
        class="mb-6 border-b border-surface-200 pb-6 dark:border-surface-800"
      >
        <div class="mb-4 flex items-center gap-2">
          <Mail class="size-4 text-brand-600 dark:text-brand-400" />
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Forwarded candidate</h2>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label for="forwarded-name" class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Name</label>
            <input id="forwarded-name" v-model="forwardedDraft.name" maxlength="200" class="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100" />
          </div>
          <div>
            <label for="forwarded-email" class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Email</label>
            <input id="forwarded-email" v-model="forwardedDraft.email" type="email" maxlength="255" class="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100" />
          </div>
          <div>
            <label for="forwarded-phone" class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Phone</label>
            <input id="forwarded-phone" v-model="forwardedDraft.phone" maxlength="50" class="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100" />
          </div>
          <div>
            <label for="forwarded-notes" class="mb-1 block text-sm font-medium text-surface-700 dark:text-surface-300">Notes</label>
            <input id="forwarded-notes" v-model="forwardedDraft.notes" maxlength="1000" class="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100" />
          </div>
        </div>
        <div v-if="preview.attachments.length" class="mt-4 flex flex-wrap gap-2">
          <span v-for="attachment in preview.attachments" :key="attachment.id" class="inline-flex items-center gap-1.5 rounded-md border border-surface-200 px-2.5 py-1.5 text-xs text-surface-600 dark:border-surface-700 dark:text-surface-300">
            <Paperclip class="size-3.5" />
            {{ attachment.filename }}
          </span>
        </div>
        <button type="button" :disabled="savingForwarded" class="mt-4 inline-flex items-center gap-2 rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800" @click="saveForwardedCandidate">
          <Loader2 v-if="savingForwarded" class="size-4 animate-spin" />
          <Save v-else class="size-4" />
          Save details
        </button>
      </div>

      <!-- Target job banner -->
      <div
        v-if="targetJob"
        class="mb-6 flex items-center gap-2 rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50 dark:bg-brand-950/40 p-3 text-sm text-brand-700 dark:text-brand-300"
      >
        <Briefcase class="size-4 flex-none" />
        <span>These people will be added as applicants to <span class="font-semibold">{{ targetJob.title }}</span> and land in its pipeline.</span>
      </div>

      <!-- Summary tiles -->
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-xl border border-surface-200 dark:border-surface-800 p-4">
          <p class="text-2xl font-bold tabular-nums text-surface-900 dark:text-surface-100">{{ summary.total }}</p>
          <p class="text-xs text-surface-500">Total rows</p>
        </div>
        <div class="rounded-xl border border-success-200 dark:border-success-900 bg-success-50/50 dark:bg-success-950/30 p-4">
          <p class="text-2xl font-bold tabular-nums text-success-700 dark:text-success-400">{{ summary.ready }}</p>
          <p class="text-xs text-surface-500">Ready to import</p>
        </div>
        <div class="rounded-xl border border-warning-200 dark:border-warning-900 bg-warning-50/50 dark:bg-warning-950/30 p-4">
          <p class="text-2xl font-bold tabular-nums text-warning-700 dark:text-warning-400">{{ summary.duplicate + summary.duplicateInFile }}</p>
          <p class="text-xs text-surface-500">Duplicates</p>
        </div>
        <div class="rounded-xl border border-danger-200 dark:border-danger-900 bg-danger-50/50 dark:bg-danger-950/30 p-4">
          <p class="text-2xl font-bold tabular-nums text-danger-700 dark:text-danger-400">{{ summary.error }}</p>
          <p class="text-xs text-surface-500">Errors (skipped)</p>
        </div>
      </div>

      <!-- Duplicate policy -->
      <div v-if="summary.duplicate > 0" class="mb-6 rounded-xl border border-surface-200 dark:border-surface-800 p-4">
        <p class="mb-3 text-sm font-medium text-surface-900 dark:text-surface-100">
          {{ summary.duplicate }} row{{ summary.duplicate === 1 ? '' : 's' }} match an existing candidate. What should we do?
        </p>
        <div class="space-y-2">
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="duplicatePolicy" type="radio" value="skip" class="mt-0.5 accent-brand-600" />
            <span class="text-sm">
              <span class="font-medium text-surface-900 dark:text-surface-100">Skip them</span>
              <span class="block text-xs text-surface-500">Leave existing candidates untouched (recommended).</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-2.5">
            <input v-model="duplicatePolicy" type="radio" value="update" class="mt-0.5 accent-brand-600" />
            <span class="text-sm">
              <span class="font-medium text-surface-900 dark:text-surface-100">Update them</span>
              <span class="block text-xs text-surface-500">Overwrite name, phone, and other fields with the values from this file.</span>
            </span>
          </label>
        </div>
      </div>

      <!-- Sample rows -->
      <div class="overflow-hidden rounded-xl border border-surface-200 dark:border-surface-800">
        <div class="flex items-center justify-between border-b border-surface-100 dark:border-surface-800 px-4 py-2.5">
          <p class="text-xs font-medium uppercase tracking-wide text-surface-500">Preview</p>
          <p class="text-xs text-surface-400">
            First {{ preview.sampleRows.length }} of {{ summary.total }} rows
          </p>
        </div>
        <table class="w-full text-sm">
          <thead class="bg-surface-50 dark:bg-surface-900 text-left text-xs font-medium uppercase tracking-wide text-surface-500">
            <tr>
              <th class="px-4 py-2.5 w-12">#</th>
              <th class="px-4 py-2.5">Name</th>
              <th class="px-4 py-2.5">Email</th>
              <th class="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-surface-100 dark:divide-surface-800">
            <tr v-for="row in preview.sampleRows" :key="row.id">
              <td class="px-4 py-2.5 tabular-nums text-surface-400">{{ row.rowIndex + 1 }}</td>
              <td class="px-4 py-2.5 text-surface-900 dark:text-surface-100">{{ rowName(row) }}</td>
              <td class="px-4 py-2.5 text-surface-500 dark:text-surface-400">{{ row.normalizedData?.email ?? '—' }}</td>
              <td class="px-4 py-2.5">
                <span
                  class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="STATUS_META[row.status].classes"
                >
                  <component :is="STATUS_META[row.status].icon" class="size-3" />
                  {{ STATUS_META[row.status].label }}
                </span>
                <span v-if="row.errorMessage" class="ml-2 text-xs text-danger-500">{{ row.errorMessage }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex items-center gap-3">
        <button
          type="button"
          :disabled="committing || savingForwarded || willImport === 0"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          @click="commit"
        >
          <Loader2 v-if="committing" class="size-4 animate-spin" />
          {{ committing ? 'Importing…' : `Import ${willImport} ${noun}${willImport === 1 ? '' : 's'}` }}
        </button>
        <button
          type="button"
          :disabled="committing"
          class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 transition-colors"
          @click="leaveReview"
        >
          {{ isEmailForward ? 'Back to imports' : 'Back to mapping' }}
        </button>
      </div>
    </section>

    <!-- ── Step 4 · Done ── -->
    <section v-else-if="step === 'done' && commitResult" class="text-center">
      <div class="mx-auto flex size-14 items-center justify-center rounded-full bg-success-50 dark:bg-success-950">
        <PartyPopper class="size-7 text-success-600 dark:text-success-400" />
      </div>
      <h2 class="mt-4 text-xl font-bold text-surface-900 dark:text-surface-100">Import complete</h2>
      <p class="mt-1 text-sm text-surface-500">
        {{ commitResult.created }} created<template v-if="commitResult.updated"> · {{ commitResult.updated }} updated</template>
        <template v-if="commitResult.skipped"> · {{ commitResult.skipped }} skipped</template>
      </p>
      <p v-if="targetJob && commitResult.applied" class="mt-1 inline-flex items-center gap-1.5 text-sm text-surface-600 dark:text-surface-400">
        <Briefcase class="size-4" />
        {{ commitResult.applied }} added as applicants to {{ targetJob.title }}
      </p>

      <div class="mt-6 flex items-center justify-center gap-3">
        <NuxtLink
          :to="targetJob
            ? localePath(`/dashboard/jobs/${targetJob.id}`)
            : localePath('/dashboard/candidates')"
          class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          {{ targetJob ? 'View pipeline' : 'View candidates' }}
        </NuxtLink>
        <NuxtLink
          :to="targetJob
            ? localePath(`/dashboard/jobs/${targetJob.id}/import`)
            : localePath('/dashboard/candidates/import')"
          class="rounded-lg border border-surface-300 dark:border-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          @click="() => { step = 'upload'; file = null; preview = null; commitResult = null }"
        >
          Import another file
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
