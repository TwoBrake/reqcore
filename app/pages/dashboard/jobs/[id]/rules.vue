<script setup lang="ts">
import type { ApplicationRuleInput, QuestionType } from '~~/shared/application-rules'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string
const toast = useToast()
const { handlePreviewReadOnlyError } = usePreviewReadOnly()

const { job } = useJob(jobId)
const { questions } = useJobQuestions(jobId)
const { rules, status, error, saveRules, runRules } = useApplicationRules(jobId)

useSeoMeta({
  title: computed(() =>
    job.value ? `Automation Rules — ${job.value.title} — Reqcore` : 'Automation Rules — Reqcore',
  ),
})

const builderQuestions = computed(() =>
  (questions.value ?? []).map((q: any) => ({
    id: q.id,
    label: q.label,
    type: q.type as QuestionType,
    options: q.options ?? null,
  })),
)

const saving = ref(false)
const running = ref(false)

async function onSave(payload: ApplicationRuleInput[]) {
  saving.value = true
  try {
    await saveRules(payload)
    toast.success('Rules saved', 'New applicants will be categorized automatically.')
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to save rules', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    saving.value = false
  }
}

async function onRun() {
  running.value = true
  try {
    const res = await runRules()
    if (res.matched === 0) {
      toast.info('No matches', `Checked ${res.evaluated} applicant${res.evaluated === 1 ? '' : 's'} — none matched your rules.`)
    } else {
      const parts = Object.entries(res.byAction).map(([action, n]) => `${n} → ${action}`)
      toast.success(`${res.matched} applicant${res.matched === 1 ? '' : 's'} updated`, parts.join(', '))
      refreshNuxtData(`pipeline-apps-${jobId}`)
    }
  } catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    toast.error('Failed to run rules', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <JobSubNavActions :job-id="jobId" />

    <div v-if="status === 'pending'" class="text-center py-12 text-surface-400">
      Loading…
    </div>

    <div
      v-else-if="error"
      class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-4 text-sm text-danger-700 dark:text-danger-400"
    >
      Failed to load automation rules.
    </div>

    <ApplicationRulesBuilder
      v-else
      :questions="builderQuestions"
      :server-rules="rules"
      :saving="saving"
      :running="running"
      @save="onSave"
      @run="onRun"
    />
  </div>
</template>
