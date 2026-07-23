<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const jobId = route.params.id as string

// ─────────────────────────────────────────────
// Fetch job info for page header / title
// ─────────────────────────────────────────────

const { data: jobData, status: jobFetchStatus, error: jobError } = useFetch(
  () => `/api/jobs/${jobId}`,
  {
    key: `candidates-job-${jobId}`,
    headers: useRequestHeaders(['cookie']),
  },
)

useSeoMeta({
  title: computed(() =>
    jobData.value ? `Table — ${jobData.value.title} — Reqcore` : 'Table — Reqcore',
  ),
})

// Deep-link: open the drawer on a specific application when linked in via ?application=<id>
const initialApplicationId = typeof route.query.application === 'string'
  ? route.query.application
  : null
</script>

<template>
  <div class="-mb-6 flex h-[calc(100%+1.5rem)] flex-col lg:-mb-8 lg:h-[calc(100%+2rem)]">
    <JobSubNavActions :job-id="jobId" />

    <!-- Loading -->
    <div v-if="jobFetchStatus === 'pending'" class="flex flex-col items-center justify-center py-12 gap-3">
      <div class="size-8 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400 animate-spin" />
      <p class="text-sm font-medium text-surface-400 dark:text-surface-500">Loading candidates…</p>
    </div>

    <!-- Error -->
    <div
      v-else-if="jobError"
      class="rounded-xl border border-danger-200/80 bg-danger-50 p-5 text-sm text-danger-700 dark:border-danger-800/60 dark:bg-danger-950/40 dark:text-danger-300"
    >
      Job not found or failed to load.
      <NuxtLink :to="$localePath('/dashboard')" class="ml-1 font-medium underline hover:no-underline">Back to Jobs</NuxtLink>
    </div>

    <ApplicationsList
      v-else-if="jobData"
      :job-id="jobId"
      :initial-application-id="initialApplicationId"
    />
  </div>
</template>
