<script setup lang="ts">
import { ArrowRight, Check, Mail } from 'lucide-vue-next'
import { FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT, getBillingPlan } from '~~/shared/billing'

withDefaults(defineProps<{
  compact?: boolean
}>(), { compact: false })

const solo = getBillingPlan('solo')!
</script>

<template>
  <section
    class="border border-brand-200 bg-brand-50/60 dark:border-brand-900/70 dark:bg-brand-950/25"
    :class="compact ? 'rounded-lg p-3' : 'rounded-lg p-4 sm:p-5'"
  >
    <div class="flex items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
        <Mail class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-surface-950 dark:text-white">Start more conversations</p>
        <p class="mt-1 text-xs leading-5 text-surface-600 dark:text-surface-300">
          You've started all {{ FREE_PLAN_CANDIDATE_CONVERSATION_LIMIT }} free candidate conversations. Existing threads stay open with unlimited replies. Upgrade to Solo to reach more candidates.
        </p>

        <div v-if="!compact" class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-surface-700 dark:text-surface-200">
          <span class="inline-flex items-center gap-1.5"><Check class="size-3.5 text-success-600" /> Unlimited candidate conversations</span>
          <span class="inline-flex items-center gap-1.5"><Check class="size-3.5 text-success-600" /> Full two-way inbox</span>
        </div>

        <NuxtLink
          :to="$localePath('/dashboard/settings/billing')"
          class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white no-underline transition-colors hover:bg-brand-700"
        >
          Upgrade to Solo · ${{ solo.monthlyPrice }}/mo
          <ArrowRight class="size-3.5" />
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
