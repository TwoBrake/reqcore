<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Applications — Reqcore',
  description: 'Manage applications across all jobs',
})
</script>

<template>
  <div class="-mb-6 flex h-[calc(100%+1.5rem)] flex-col lg:-mb-8 lg:h-[calc(100%+2rem)]">
    <ApplicationsList />
  </div>
</template>
