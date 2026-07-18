<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
  fullbleed: true,
})

useSeoMeta({
  title: 'Candidate Inbox — Reqcore',
  description: 'Candidate conversations',
  robots: 'noindex, nofollow',
})
</script>

<template>
  <CandidateInbox sync-route />
</template>
