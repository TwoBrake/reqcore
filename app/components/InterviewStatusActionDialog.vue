<script setup lang="ts">
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-vue-next'

type InterviewOutcome = 'completed' | 'cancelled' | 'no_show'

const props = defineProps<{
  open: boolean
  action: InterviewOutcome | null
  candidateName: string
  candidateEmail: string
  invitationSentAt: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const content = computed(() => {
  if (props.action === 'cancelled') {
    return props.invitationSentAt
      ? {
          title: 'Cancel interview?',
          description: `${props.candidateName} will receive a cancellation at ${props.candidateEmail}, including a calendar cancellation.`,
          confirmLabel: 'Cancel and send',
          icon: XCircle,
          iconClass: 'bg-danger-50 text-danger-600 dark:bg-danger-950/40 dark:text-danger-400',
          buttonClass: 'bg-danger-600 hover:bg-danger-700',
        }
      : {
          title: 'Cancel interview?',
          description: 'No interview proposal was sent, so this only changes the internal status. The candidate will not be notified.',
          confirmLabel: 'Cancel interview',
          icon: XCircle,
          iconClass: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300',
          buttonClass: 'bg-danger-600 hover:bg-danger-700',
        }
  }

  if (props.action === 'no_show') {
    return {
      title: 'Mark as no-show?',
      description: 'This is an internal recruiting status. The candidate will not be notified or receive a message.',
      confirmLabel: 'Mark no-show',
      icon: AlertTriangle,
      iconClass: 'bg-warning-50 text-warning-700 dark:bg-warning-950/40 dark:text-warning-400',
      buttonClass: 'bg-danger-600 hover:bg-danger-700',
    }
  }

  return {
    title: 'Mark interview completed?',
    description: 'This is an internal recruiting status. The candidate will not be notified or receive a message.',
    confirmLabel: 'Mark completed',
    icon: CheckCircle2,
    iconClass: 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-400',
    buttonClass: 'bg-success-600 hover:bg-success-700',
  }
})

function close() {
  if (!props.loading) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && action" class="fixed inset-0 z-[80] grid place-items-center px-4" role="dialog" aria-modal="true" :aria-label="content.title">
      <button class="absolute inset-0 bg-black/45" aria-label="Close confirmation" @click="close" />
      <section class="relative w-full max-w-md rounded-lg border border-surface-200 bg-white p-5 shadow-2xl dark:border-surface-700 dark:bg-surface-900">
        <button type="button" class="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200" aria-label="Close" @click="close">
          <X class="size-4" />
        </button>

        <div class="flex items-start gap-3 pr-8">
          <div class="grid size-10 shrink-0 place-items-center rounded-lg" :class="content.iconClass">
            <component :is="content.icon" class="size-5" />
          </div>
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-surface-900 dark:text-white">{{ content.title }}</h2>
            <p class="mt-1.5 text-sm leading-6 text-surface-600 dark:text-surface-300">{{ content.description }}</p>
          </div>
        </div>

        <footer class="mt-5 flex justify-end gap-2">
          <button type="button" class="h-9 rounded-lg border border-surface-300 px-3 text-sm font-medium text-surface-700 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800" :disabled="loading" @click="close">Keep interview</button>
          <button type="button" class="h-9 rounded-lg px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" :class="content.buttonClass" :disabled="loading" @click="emit('confirm')">
            {{ loading ? 'Updating…' : content.confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
