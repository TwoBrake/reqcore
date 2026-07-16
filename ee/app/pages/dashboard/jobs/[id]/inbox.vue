<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
  fullbleed: true,
})

const route = useRoute()
const jobId = route.params.id as string

const { data: jobData } = useFetch(() => `/api/jobs/${jobId}`, {
  key: `inbox-job-${jobId}`,
  headers: useRequestHeaders(['cookie']),
})

useSeoMeta({
  title: computed(() => jobData.value ? `Inbox — ${jobData.value.title} — Reqcore` : 'Inbox — Reqcore'),
  robots: 'noindex, nofollow',
})
</script>

<template>
  <CandidateInbox :job-id="jobId" :job-title="jobData?.title" />
</template>
