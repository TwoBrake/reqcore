<script setup lang="ts">
import {
  AlertCircle, Check, CheckCheck, Clock3, ExternalLink, Inbox, Mail, Maximize2, Minimize2, Paperclip, RefreshCw, Send,
} from 'lucide-vue-next'
import {
  CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT,
  CANDIDATE_MESSAGE_MAX_ATTACHMENTS,
} from '~~/shared/candidate-messaging'
import { candidateMessageKindLabel } from '../composables/useCandidateMessages'
import type { CandidateConversation, CandidateMessageStatus } from '../composables/useCandidateMessages'

const props = defineProps<{
  applicationId: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
}>()

const toast = useToast()
const localePath = useLocalePath()
const { hasFeature, status: billingStatus } = usePlanFeature()
const canUse = computed(() => hasFeature('candidateMessaging'))
const billingResolved = computed(() => billingStatus.value != null)
const {
  conversations,
  selected,
  loadingList,
  loadingConversation,
  error,
  allowance,
  loadInbox,
  loadConversation,
  sendMessage,
} = useCandidateMessages()

const body = ref('')
const subject = ref('')
const requestId = ref<string | null>(null)
const expanded = ref(false)
const {
  files: attachments,
  add: addAttachments,
  remove: removeAttachment,
  clear: clearAttachments,
} = useCandidateMessageAttachments(() => { requestId.value = null })
const isSending = ref(false)

const loading = computed(() => loadingList.value || loadingConversation.value)
const hasConversation = computed(() => selected.value?.applicationId === props.applicationId)
const messages = computed(() => hasConversation.value ? selected.value!.messages : [])
const defaultSubject = computed(() => `Regarding ${props.jobTitle}`)

const inboxLink = computed(() => localePath({
  path: '/dashboard/inbox',
  query: hasConversation.value && selected.value
    ? { conversation: selected.value.id }
    : { applicationId: props.applicationId },
}))

const statusMeta: Record<CandidateMessageStatus, { label: string, icon: typeof Check, class: string }> = {
  queued: { label: 'Queued', icon: Clock3, class: 'text-surface-400' },
  sent: { label: 'Sent', icon: Check, class: 'text-surface-400' },
  delivered: { label: 'Delivered', icon: CheckCheck, class: 'text-success-600 dark:text-success-400' },
  delayed: { label: 'Delayed', icon: Clock3, class: 'text-warning-600 dark:text-warning-400' },
  bounced: { label: 'Bounced', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
  failed: { label: 'Failed', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
  complained: { label: 'Spam complaint', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
}

async function loadThread(options: { quiet?: boolean } = {}) {
  try {
    await loadInbox({ applicationId: props.applicationId })
    const conversation = conversations.value.find(item => item.applicationId === props.applicationId)
    if (conversation) {
      await loadConversation(conversation.id)
    } else {
      selected.value = null
      subject.value ||= defaultSubject.value
    }
  } catch (err: any) {
    if (!options.quiet) {
      toast.error('Could not load messages', { message: err.data?.statusMessage })
    }
  }
}

async function refreshThread() {
  await loadThread()
}

async function submitMessage() {
  const trimmedBody = body.value.trim()
  const messageSubject = hasConversation.value
    ? messages.value.at(-1)?.subject ?? defaultSubject.value
    : subject.value.trim()
  if (!trimmedBody || !messageSubject) return

  requestId.value ??= crypto.randomUUID()
  isSending.value = true
  try {
    await sendMessage({
      applicationId: props.applicationId,
      requestId: requestId.value,
      subject: messageSubject,
      body: trimmedBody,
      attachments: attachments.value,
    })
    body.value = ''
    clearAttachments()
    requestId.value = null
    toast.success('Message sent')
  } catch (err: any) {
    toast.error('Message not sent', { message: err.data?.statusMessage ?? 'Retry is safe.' })
  } finally {
    isSending.value = false
  }
}

async function retryMessage(message: CandidateConversation['messages'][number]) {
  isSending.value = true
  try {
    if (message.interviewId) {
      const result = await $fetch<{ success: boolean }>(`/api/interviews/${message.interviewId}/send-invitation`, { method: 'POST' })
      if (!result.success) throw new Error('Interview update could not be sent')
      await loadThread()
    }
    else {
      await sendMessage({
        applicationId: props.applicationId,
        requestId: message.status === 'failed' && message.errorCode === 'send_failed'
          ? message.id
          : crypto.randomUUID(),
        subject: message.subject,
        body: message.bodyText,
      })
    }
    toast.success('Message sent')
  } catch (err: any) {
    toast.error('Retry failed', { message: err.data?.statusMessage })
  } finally {
    isSending.value = false
  }
}

function messageTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

watch(billingStatus, (value) => {
  if (value && canUse.value) loadThread()
}, { immediate: true })

let pollTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pollTimer = setInterval(() => {
    if (!document.hidden && canUse.value && !loading.value && !isSending.value) {
      loadThread({ quiet: true })
    }
  }, 20_000)
})
onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <FeatureLockCard
    v-if="billingResolved && !canUse"
    feature="candidateMessaging"
  />

  <div v-else class="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
    <div class="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
      <div v-if="!billingResolved || (loading && messages.length === 0)" class="py-12 text-center text-surface-400">
        <div class="mx-auto mb-3 size-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-800 dark:border-t-brand-400" />
        <p class="text-sm">Loading messages…</p>
      </div>

      <div
        v-else-if="error && messages.length === 0"
        class="rounded-xl border border-danger-200 bg-danger-50/60 p-6 text-center dark:border-danger-900/60 dark:bg-danger-950/30"
      >
        <AlertCircle class="mx-auto mb-2 size-6 text-danger-400" />
        <p class="text-sm text-danger-700 dark:text-danger-400">Messages could not be loaded</p>
        <button
          type="button"
          class="mt-3 cursor-pointer rounded-lg border border-danger-200 px-3 py-1.5 text-xs font-medium text-danger-700 transition-colors hover:bg-danger-100 dark:border-danger-800 dark:text-danger-400 dark:hover:bg-danger-950/60"
          @click="refreshThread"
        >
          Try again
        </button>
      </div>

      <div
        v-else-if="messages.length === 0"
        class="rounded-xl border border-surface-200/80 bg-white px-6 py-9 text-center shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:shadow-none"
      >
        <div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800/60">
          <Mail class="size-5 text-surface-400 dark:text-surface-500" />
        </div>
        <p class="text-sm font-medium text-surface-600 dark:text-surface-300">No messages yet</p>
        <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">Start a conversation with {{ candidateName }} below.</p>
      </div>

      <div v-else class="flex min-w-0 flex-col gap-5" aria-live="polite">
        <article
          v-for="message in messages"
          :key="message.id"
          class="flex min-w-0 flex-col"
          :class="message.direction === 'outbound' ? 'items-end' : 'items-start'"
        >
          <p class="mb-1.5 max-w-[88%] px-1 text-xs font-medium text-surface-500 dark:text-surface-400 sm:max-w-[76%]">
            {{ message.direction === 'outbound' ? 'You' : candidateName }}
          </p>
          <span v-if="candidateMessageKindLabel(message.kind)" class="mb-1 max-w-[88%] px-1 text-[11px] font-semibold uppercase text-surface-400 sm:max-w-[76%]">
            {{ candidateMessageKindLabel(message.kind) }}
          </span>
          <div
            class="max-w-[88%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl px-4 py-3 text-sm leading-6 sm:max-w-[76%]"
            :class="message.direction === 'outbound'
              ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20 dark:bg-brand-500'
              : 'border border-surface-200/80 bg-white text-surface-800 shadow-sm shadow-surface-900/[0.03] dark:border-surface-800/60 dark:bg-surface-900 dark:text-surface-200 dark:shadow-none'"
          >{{ message.bodyText }}</div>
          <CandidateMessageAttachmentList
            :attachments="message.attachments"
            :outbound="message.direction === 'outbound'"
          />
          <div class="mt-1.5 flex max-w-[88%] flex-wrap items-center gap-2 px-1 text-xs text-surface-400 sm:max-w-[76%]">
            <span>{{ messageTime(message.createdAt) }}</span>
            <template v-if="message.direction === 'outbound'">
              <component :is="statusMeta[message.status].icon" class="size-3.5" :class="statusMeta[message.status].class" />
              <span :class="statusMeta[message.status].class">{{ statusMeta[message.status].label }}</span>
              <button
                v-if="['failed', 'bounced'].includes(message.status)"
                type="button"
                class="font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                :disabled="isSending"
                @click="retryMessage(message)"
              >Retry</button>
            </template>
          </div>
          <p v-if="message.errorMessage" class="mt-1 max-w-[88%] break-words px-1 text-xs text-danger-600 [overflow-wrap:anywhere] dark:text-danger-400 sm:max-w-[76%]">{{ message.errorMessage }}</p>
          <p v-if="message.calendarAttachmentStatus === 'failed'" class="mt-1 max-w-[88%] break-words px-1 text-xs text-danger-600 [overflow-wrap:anywhere] dark:text-danger-400 sm:max-w-[76%]">
            Calendar invitation failed: {{ message.calendarAttachmentError }}
          </p>
        </article>
      </div>
    </div>

    <form
      v-if="hasConversation || allowance.canSend"
      class="w-full min-w-0 shrink-0 rounded-xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900"
      @submit.prevent="submitMessage"
    >
      <label v-if="!hasConversation" class="mb-2 block">
        <span class="sr-only">Subject</span>
        <input
          v-model="subject"
          type="text"
          maxlength="300"
          placeholder="Subject"
          class="h-11 w-full rounded-lg border border-surface-200 bg-white px-3.5 text-sm text-surface-800 placeholder:text-surface-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
          @input="requestId = null"
        />
      </label>
      <CandidateMessagePendingAttachments
        :files="attachments"
        :disabled="isSending"
        @remove="removeAttachment"
      />
      <div class="flex min-w-0 items-end gap-2">
        <label
          class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-surface-200 text-surface-400 transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-600 dark:border-surface-700 dark:text-surface-500 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          title="Attach files"
        >
          <Paperclip class="size-[18px]" />
          <input
            type="file"
            multiple
            class="sr-only"
            :accept="CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT"
            :disabled="isSending || attachments.length >= CANDIDATE_MESSAGE_MAX_ATTACHMENTS"
            @change="addAttachments"
          />
        </label>
        <textarea
          v-model="body"
          maxlength="20000"
          :placeholder="hasConversation ? 'Write a reply…' : 'Write a message…'"
          class="min-w-0 flex-1 resize-none rounded-lg border border-surface-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-surface-800 transition-[height] placeholder:text-surface-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/20"
          :class="expanded ? 'h-44' : 'h-11'"
          @input="requestId = null"
          @keydown.enter.meta.prevent="submitMessage"
          @keydown.enter.ctrl.prevent="submitMessage"
        />
        <button
          type="button"
          class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-surface-200 text-surface-400 transition-colors hover:border-surface-300 hover:bg-surface-50 hover:text-surface-600 dark:border-surface-700 dark:text-surface-500 dark:hover:border-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
          :title="expanded ? 'Minimize' : 'Expand'"
          @click="expanded = !expanded"
        >
          <Minimize2 v-if="expanded" class="size-[18px]" />
          <Maximize2 v-else class="size-[18px]" />
        </button>
        <button
          type="submit"
          class="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand-500 dark:hover:bg-brand-400"
          :disabled="isSending || !body.trim() || (!hasConversation && !subject.trim())"
        >
          <RefreshCw v-if="isSending" class="size-4 animate-spin" />
          <Send v-else class="size-4" />
          <span class="hidden sm:inline">Send</span>
        </button>
      </div>
      <div class="mt-2.5 flex items-end justify-between gap-3 px-1">
        <p class="min-w-0 break-words px-0.5 text-[11px] text-surface-400 [overflow-wrap:anywhere] dark:text-surface-500">
          <template v-if="allowance.remaining != null && !hasConversation"><span class="font-semibold text-surface-500 dark:text-surface-400">{{ allowance.remaining }} of {{ allowance.limit }} free conversations left.</span> Starting this uses one; replies stay unlimited. </template>
          Messages are emailed to {{ candidateEmail }}. <kbd class="rounded border border-surface-200 bg-surface-50 px-1 py-px font-mono text-[10px] font-medium text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400">⌘</kbd><kbd class="rounded border border-surface-200 bg-surface-50 px-1 py-px font-mono text-[10px] font-medium text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400">Enter</kbd> to send.
        </p>
        <div class="flex shrink-0 items-center gap-1">
          <NuxtLink
            :to="inboxLink"
            class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200"
          >
            <Inbox class="size-3" />
            <span class="hidden sm:inline">Open in inbox</span>
            <ExternalLink class="size-2.5 opacity-60" />
          </NuxtLink>
          <button
            type="button"
            title="Refresh messages"
            class="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200"
            :disabled="loading"
            @click="refreshThread"
          >
            <RefreshCw class="size-3" :class="loading ? 'animate-spin' : ''" />
          </button>
        </div>
      </div>
    </form>
    <CandidateMessageUpgradePrompt v-else class="min-w-0 shrink-0" />
  </div>
</template>
