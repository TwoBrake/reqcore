<script setup lang="ts">
import { ArrowRight, ClipboardList, X } from 'lucide-vue-next'

/**
 * A second bite at the onboarding survey for users who skipped or abandoned it.
 * We don't hard-gate the survey (that would tax activation), so this dismissable
 * nudge is how partial/no-response users get re-prompted without friction.
 */
const localePath = useLocalePath()
const { track } = useTrack()

const DISMISS_KEY = 'reqcore:onboarding-survey-banner-dismissed'
const dismissed = ref(true)

// Only ask users who haven't finished the survey. Partial rows count as
// unfinished — completedAt is the server's source of truth.
const { data } = await useFetch('/api/onboarding-survey')
const completed = computed(() => !!data.value?.completed)

onMounted(() => {
  dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
})

const show = computed(() => !completed.value && !dismissed.value)

function dismiss() {
  dismissed.value = true
  localStorage.setItem(DISMISS_KEY, '1')
  track('onboarding_survey_banner_dismissed', {})
}

function open() {
  track('onboarding_survey_banner_clicked', {})
}
</script>

<template>
  <div
    v-if="show"
    class="border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100 sm:px-6"
  >
    <div class="mx-auto flex max-w-7xl items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <ClipboardList class="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
        <p class="min-w-0 truncate text-sm">
          <span class="font-semibold">Two quick questions to tailor Reqcore</span>
          <span class="ml-1 text-brand-700 dark:text-brand-300">— it takes under a minute.</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <NuxtLink
          :to="localePath('/onboarding/welcome')"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-300 bg-white px-3 text-xs font-semibold text-brand-800 transition-colors hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-200 dark:hover:bg-brand-900"
          @click="open"
        >
          Tailor Reqcore
          <ArrowRight class="size-3.5" />
        </NuxtLink>
        <button
          type="button"
          aria-label="Dismiss"
          class="inline-flex size-8 items-center justify-center rounded-md text-brand-600 transition-colors hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-900"
          @click="dismiss"
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>
