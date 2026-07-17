<script setup lang="ts">
import { CalendarClock, CheckCircle2, CircleX, Clock3 } from 'lucide-vue-next'

type CandidateResponse = 'pending' | 'accepted' | 'declined' | 'tentative'

const props = withDefaults(defineProps<{
  response: CandidateResponse
  respondedAt?: string | null
  variant?: 'badge' | 'panel'
}>(), {
  respondedAt: null,
  variant: 'badge',
})

const responseConfig = {
  pending: {
    label: 'Awaiting candidate response',
    description: 'The candidate has not responded to the invitation yet.',
    icon: Clock3,
    badgeClass: 'border-surface-300 bg-surface-100 text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300',
    panelClass: 'border-surface-300 bg-surface-50 text-surface-800 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200',
    iconClass: 'bg-surface-200 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
  },
  accepted: {
    label: 'Candidate confirmed',
    description: 'The candidate confirmed they can attend this interview.',
    icon: CheckCircle2,
    badgeClass: 'border-success-300 bg-success-50 text-success-800 dark:border-success-800 dark:bg-success-950/50 dark:text-success-300',
    panelClass: 'border-success-300 bg-success-50 text-success-900 dark:border-success-800 dark:bg-success-950/40 dark:text-success-200',
    iconClass: 'bg-success-100 text-success-700 dark:bg-success-900/60 dark:text-success-300',
  },
  declined: {
    label: 'Candidate declined',
    description: 'The candidate declined this interview invitation.',
    icon: CircleX,
    badgeClass: 'border-danger-300 bg-danger-50 text-danger-800 dark:border-danger-800 dark:bg-danger-950/50 dark:text-danger-300',
    panelClass: 'border-danger-300 bg-danger-50 text-danger-900 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-200',
    iconClass: 'bg-danger-100 text-danger-700 dark:bg-danger-900/60 dark:text-danger-300',
  },
  tentative: {
    label: 'Another time requested',
    description: 'The candidate requested a different interview time. Rescheduling is needed.',
    icon: CalendarClock,
    badgeClass: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
    panelClass: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    iconClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
  },
} satisfies Record<CandidateResponse, {
  label: string
  description: string
  icon: typeof Clock3
  badgeClass: string
  panelClass: string
  iconClass: string
}>

const config = computed(() => responseConfig[props.response])

function formatRespondedAt(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
</script>

<template>
  <span
    v-if="variant === 'badge'"
    class="inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold"
    :class="config.badgeClass"
  >
    <component :is="config.icon" class="size-3.5 shrink-0" />
    {{ config.label }}
  </span>

  <div
    v-else
    role="status"
    class="flex items-start gap-3.5 rounded-lg border px-4 py-3.5"
    :class="config.panelClass"
  >
    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg" :class="config.iconClass">
      <component :is="config.icon" class="size-5" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-[0.6875rem] font-semibold uppercase tracking-wide opacity-60">Candidate response</p>
      <div class="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p class="text-base font-semibold">{{ config.label }}</p>
        <p v-if="respondedAt" class="text-xs font-medium opacity-70">
          Responded {{ formatRespondedAt(respondedAt) }}
        </p>
      </div>
      <p class="mt-1 text-sm opacity-80">{{ config.description }}</p>
    </div>
  </div>
</template>
