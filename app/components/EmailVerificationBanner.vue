<script setup lang="ts">
import { Check, Loader2, MailWarning, RefreshCw } from 'lucide-vue-next'

const { data: session } = await authClient.useSession(useFetch)
const route = useRoute()
const resendState = ref<'idle' | 'sending' | 'sent'>('idle')
const resendError = ref('')
let resendResetTimer: ReturnType<typeof setTimeout> | undefined

const needsVerification = computed(() => (
  !!session.value?.user && !session.value.user.emailVerified
))

async function resendVerification() {
  const email = session.value?.user.email
  if (!email || resendState.value === 'sending') return

  resendState.value = 'sending'
  resendError.value = ''

  try {
    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: route.fullPath,
    })
    if (result.error) throw new Error(result.error.message ?? 'Verification email could not be sent.')
    resendState.value = 'sent'
    resendResetTimer = setTimeout(() => {
      resendState.value = 'idle'
    }, 30_000)
  }
  catch (error) {
    resendState.value = 'idle'
    resendError.value = error instanceof Error
      ? error.message
      : 'Verification email could not be sent.'
  }
}

onBeforeUnmount(() => clearTimeout(resendResetTimer))
</script>

<template>
  <div
    v-if="needsVerification"
    aria-live="polite"
    class="border-b border-warning-200 bg-warning-50 px-4 py-2.5 text-warning-900 dark:border-warning-900 dark:bg-warning-950/50 dark:text-warning-100 sm:px-6"
  >
    <div class="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-start gap-2.5 sm:items-center">
        <MailWarning class="mt-0.5 size-4 shrink-0 text-warning-600 dark:text-warning-400 sm:mt-0" />
        <p class="min-w-0 text-sm">
          <span class="font-semibold">Verify your email to send messages and invitations.</span>
          <span class="ml-1 text-warning-700 dark:text-warning-300">
            Check {{ session?.user.email }} for the link.
          </span>
          <span v-if="resendError" class="ml-1 text-danger-700 dark:text-danger-400">{{ resendError }}</span>
        </p>
      </div>
      <button
        type="button"
        :disabled="resendState !== 'idle'"
        class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-warning-300 bg-white px-3 text-xs font-semibold text-warning-800 transition-colors hover:bg-warning-100 disabled:cursor-default disabled:opacity-70 dark:border-warning-800 dark:bg-warning-950 dark:text-warning-200 dark:hover:bg-warning-900"
        @click="resendVerification"
      >
        <Loader2 v-if="resendState === 'sending'" class="size-3.5 animate-spin" />
        <Check v-else-if="resendState === 'sent'" class="size-3.5" />
        <RefreshCw v-else class="size-3.5" />
        {{ resendState === 'sending' ? 'Sending' : resendState === 'sent' ? 'Link sent' : 'Resend link' }}
      </button>
    </div>
  </div>
</template>
