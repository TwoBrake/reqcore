<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

const route = useRoute()
const applicationId = route.params.id as string
const localePath = useLocalePath()

async function handleDeleted() {
  await navigateTo(localePath('/dashboard/applications'))
}
</script>

<template>
  <ApplicationDetail :application-id="applicationId" variant="page" @deleted="handleDeleted">
    <template #top>
      <NuxtLink
        :to="$localePath('/dashboard/applications')"
        class="mb-4 inline-flex items-center gap-1 rounded-full border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-3 py-1.5 text-sm text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
      >
        <ArrowLeft class="size-4" />
        Back to Applications
      </NuxtLink>
    </template>
  </ApplicationDetail>
</template>
