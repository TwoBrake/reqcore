<script setup lang="ts">
import {
  AlertCircle, ArrowLeft, Briefcase, Check, CheckCheck, ChevronDown, Clock3, Inbox,
  Mail, Paperclip, Plus, RefreshCw, Search, Send, X,
} from 'lucide-vue-next'
import {
  CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT,
  CANDIDATE_MESSAGE_MAX_ATTACHMENTS,
} from '~~/shared/candidate-messaging'
import { candidateMessageKindLabel } from '../composables/useCandidateMessages'
import type { CandidateConversation, CandidateConversationSummary, CandidateMessageStatus } from '../composables/useCandidateMessages'

/**
 * Self-contained candidate inbox. Drops into the standalone inbox page or any
 * job-scoped surface. Pass `jobId` to lock the inbox to a single job — the job
 * filter is hidden and every list, compose picker and deep-link stays scoped to
 * that job. Leave it out for the org-wide inbox with a job filter selector.
 */
const props = defineProps<{
  jobId?: string | null
  /** Optional job title for the locked-mode header; resolved from data otherwise. */
  jobTitle?: string
  /** When true, syncs the selected conversation to the URL query (standalone page). */
  syncRoute?: boolean
}>()

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { formatCandidateName } = useOrgSettings()
const { hasFeature, status: billingStatus } = usePlanFeature()
const canUse = computed(() => hasFeature('candidateMessaging'))
const billingResolved = computed(() => billingStatus.value != null)

const isLocked = computed(() => typeof props.jobId === 'string' && props.jobId.length > 0)

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

const search = ref('')
const jobFilter = ref<string>(props.jobId ?? '')
const selectedId = ref<string | null>(null)
const showCompose = ref(false)
const isSending = ref(false)
const replyBody = ref('')
const replyRequestId = ref<string | null>(null)
const composeRequestId = ref<string | null>(null)
const {
  files: replyAttachments,
  add: addReplyAttachments,
  remove: removeReplyAttachment,
  clear: clearReplyAttachments,
} = useCandidateMessageAttachments(() => { replyRequestId.value = null })
const {
  files: composeAttachments,
  add: addComposeAttachments,
  remove: removeComposeAttachment,
  clear: clearComposeAttachments,
} = useCandidateMessageAttachments(() => { composeRequestId.value = null })
const compose = reactive({ applicationId: '', subject: '', body: '' })

const activeJobId = computed(() => (isLocked.value ? props.jobId! : jobFilter.value) || undefined)

// Jobs for the filter selector — skipped entirely when locked to a single job.
const { data: jobsData, execute: loadJobs } = useFetch('/api/jobs', {
  key: 'candidate-inbox-jobs',
  query: { limit: 100 },
  headers: useRequestHeaders(['cookie']),
  immediate: false,
})
const jobs = computed<Array<{ id: string, title: string }>>(() => jobsData.value?.data ?? [])

const lockedJobTitle = computed(() => {
  if (!isLocked.value) return null
  return props.jobTitle
    ?? conversations.value.find(c => c.application.job.id === props.jobId)?.application.job.title
    ?? 'this job'
})

const { data: applicationsData, execute: loadApplications } = useFetch('/api/applications', {
  key: 'candidate-inbox-applications',
  query: { limit: 100, sort: 'updated-desc', jobId: activeJobId },
  headers: useRequestHeaders(['cookie']),
  immediate: false,
  watch: false,
})
const applications = computed(() => applicationsData.value?.data ?? [])

const filteredConversations = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return conversations.value
  return conversations.value.filter((conversation) => {
    const candidate = conversation.application.candidate
    return `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(term)
      || candidate.email.toLowerCase().includes(term)
      || conversation.application.job.title.toLowerCase().includes(term)
  })
})

const totalUnread = computed(() =>
  conversations.value.reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0),
)

watch(billingStatus, async (value) => {
  if (!value || !canUse.value || conversations.value.length > 0) return
  if (!isLocked.value) loadJobs()
  await initializeInbox()
}, { immediate: true })

// Reload when the job filter changes on the org-wide inbox.
watch(jobFilter, async () => {
  if (isLocked.value) return
  selectedId.value = null
  selected.value = null
  try {
    await loadInbox({ jobId: activeJobId.value })
  } catch {
    // The list-level error state handles the failure.
  }
})

async function initializeInbox() {
  try {
    await loadInbox({ jobId: activeJobId.value })
    const applicationId = props.syncRoute && typeof route.query.applicationId === 'string' ? route.query.applicationId : null
    const conversationId = props.syncRoute && typeof route.query.conversation === 'string' ? route.query.conversation : null
    const matching = conversationId
      ? conversations.value.find(item => item.id === conversationId)
      : applicationId
        ? conversations.value.find(item => item.applicationId === applicationId)
        : conversations.value[0]
    if (matching) {
      await selectConversation(matching)
    } else if (applicationId) {
      await openCompose(applicationId)
    }
  } catch {
    // The list-level error state handles the initial failure.
  }
}

async function selectConversation(conversation: CandidateConversationSummary) {
  replyBody.value = ''
  clearReplyAttachments()
  replyRequestId.value = null
  selectedId.value = conversation.id
  if (props.syncRoute) {
    await router.replace({ query: { ...route.query, conversation: conversation.id, applicationId: undefined } })
  }
  try {
    await loadConversation(conversation.id)
  } catch (err: any) {
    toast.error('Could not load conversation', { message: err.data?.statusMessage })
  }
}

async function refresh() {
  try {
    await loadInbox({ jobId: activeJobId.value })
    if (selectedId.value) await loadConversation(selectedId.value)
  } catch (err: any) {
    toast.error('Could not refresh inbox', { message: err.data?.statusMessage })
  }
}

async function openCompose(applicationId = '') {
  if (!allowance.value.canSend) return
  await loadApplications()
  compose.applicationId = applicationId
  compose.subject = ''
  compose.body = ''
  clearComposeAttachments()
  composeRequestId.value = null
  showCompose.value = true
}

async function submitCompose() {
  if (!compose.applicationId || !compose.subject.trim() || !compose.body.trim()) return
  composeRequestId.value ??= crypto.randomUUID()
  isSending.value = true
  try {
    await sendMessage({
      applicationId: compose.applicationId,
      requestId: composeRequestId.value,
      subject: compose.subject,
      body: compose.body,
      attachments: composeAttachments.value,
    })
    showCompose.value = false
    clearComposeAttachments()
    composeRequestId.value = null
    selectedId.value = selected.value?.id ?? null
    toast.success('Message sent')
  } catch (err: any) {
    toast.error('Message not sent', { message: err.data?.statusMessage ?? 'Retry is safe.' })
  } finally {
    isSending.value = false
  }
}

async function submitReply() {
  if (!selected.value || !replyBody.value.trim()) return
  replyRequestId.value ??= crypto.randomUUID()
  isSending.value = true
  try {
    await sendMessage({
      applicationId: selected.value.application.id,
      requestId: replyRequestId.value,
      subject: selected.value.messages.at(-1)?.subject ?? `Regarding ${selected.value.application.job.title}`,
      body: replyBody.value,
      attachments: replyAttachments.value,
    })
    replyBody.value = ''
    clearReplyAttachments()
    replyRequestId.value = null
    toast.success('Message sent')
  } catch (err: any) {
    toast.error('Message not sent', { message: err.data?.statusMessage ?? 'Retry is safe.' })
  } finally {
    isSending.value = false
  }
}

async function retryMessage(message: CandidateConversation['messages'][number]) {
  if (!selected.value) return
  isSending.value = true
  try {
    if (message.interviewId) {
      const result = await $fetch<{ success: boolean, delivery: { errorMessage: string | null } }>(
        `/api/interviews/${message.interviewId}/send-invitation`,
        { method: 'POST' },
      )
      if (!result.success) throw new Error(result.delivery.errorMessage ?? 'Interview update could not be sent')
      await Promise.all([
        loadConversation(selected.value.id, { markRead: false }),
        loadInbox({ jobId: activeJobId.value }),
      ])
    }
    else {
      await sendMessage({
        applicationId: selected.value.application.id,
        requestId: message.status === 'failed' && message.errorCode === 'send_failed'
          ? message.id
          : crypto.randomUUID(),
        subject: message.subject,
        body: message.bodyText,
      })
    }
    toast.success('Message sent')
  } catch (err: any) {
    toast.error('Retry failed', { message: err.data?.statusMessage ?? err.message })
  } finally {
    isSending.value = false
  }
}

function closeThreadOnMobile() {
  selectedId.value = null
  selected.value = null
}

function conversationName(conversation: CandidateConversationSummary) {
  return formatCandidateName(conversation.application.candidate)
}

function timeLabel(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function messageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isNewDay(index: number) {
  if (!selected.value || index === 0) return true
  const previous = selected.value.messages[index - 1]?.createdAt
  const current = selected.value.messages[index]?.createdAt
  if (!previous || !current) return false
  return new Date(previous).toDateString() !== new Date(current).toDateString()
}

function dayLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function onReplyKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    submitReply()
  }
}

const statusMeta: Record<CandidateMessageStatus, { label: string, icon: typeof Check, class: string }> = {
  queued: { label: 'Queued', icon: Clock3, class: 'text-surface-400' },
  sent: { label: 'Sent', icon: Check, class: 'text-surface-400' },
  delivered: { label: 'Delivered', icon: CheckCheck, class: 'text-success-600 dark:text-success-400' },
  delayed: { label: 'Delayed', icon: Clock3, class: 'text-warning-600 dark:text-warning-400' },
  bounced: { label: 'Bounced', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
  failed: { label: 'Failed', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
  complained: { label: 'Spam complaint', icon: AlertCircle, class: 'text-danger-600 dark:text-danger-400' },
}

let pollTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pollTimer = setInterval(() => {
    if (!document.hidden && canUse.value && !loadingList.value && !loadingConversation.value) refresh()
  }, 20_000)
})
onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <FeatureLockCard
    v-if="billingResolved && !canUse"
    feature="candidateMessaging"
    class="m-6"
  />

  <div v-else class="flex h-full min-h-0 overflow-hidden bg-white dark:bg-surface-950">
    <aside
      class="w-full shrink-0 flex-col border-r border-surface-200 dark:border-surface-800 md:flex md:w-80 lg:w-96"
      :class="selectedId ? 'hidden' : 'flex'"
    >
      <header class="flex h-16 shrink-0 items-center justify-between border-b border-surface-200 px-4 dark:border-surface-800">
        <div class="flex min-w-0 items-center gap-2">
          <Inbox class="size-5 shrink-0 text-brand-600 dark:text-brand-400" />
          <h1 class="truncate text-base font-semibold text-surface-900 dark:text-surface-100">Inbox</h1>
          <span
            v-if="totalUnread"
            class="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white"
          >
            {{ totalUnread > 99 ? '99+' : totalUnread }}
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button
            class="grid size-9 place-items-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-900 dark:hover:bg-surface-800 dark:hover:text-surface-100"
            title="Refresh"
            :disabled="loadingList"
            @click="refresh"
          >
            <RefreshCw class="size-4" :class="loadingList ? 'animate-spin' : ''" />
          </button>
          <button
            class="grid size-9 place-items-center rounded-lg bg-brand-600 text-white hover:bg-brand-700"
            :class="!allowance.canSend ? 'cursor-not-allowed opacity-50' : ''"
            :title="allowance.canSend ? 'New message' : 'Free conversation limit reached'"
            :disabled="!allowance.canSend"
            @click="openCompose()"
          >
            <Plus class="size-4" />
          </button>
        </div>
      </header>

      <div v-if="allowance.limit != null" class="border-b border-surface-200 dark:border-surface-800">
        <CandidateMessageUpgradePrompt v-if="!allowance.canSend" compact class="m-3" />
        <div v-else class="flex items-center justify-between gap-2 px-4 py-2.5">
          <p class="text-xs text-surface-500 dark:text-surface-400">
            <span class="font-semibold text-surface-700 dark:text-surface-200">{{ allowance.used }} of {{ allowance.limit }}</span>
            free conversations started
          </p>
          <NuxtLink
            :to="$localePath('/dashboard/settings/billing')"
            class="shrink-0 text-xs font-medium text-brand-600 no-underline hover:underline dark:text-brand-400"
          >
            Upgrade
          </NuxtLink>
        </div>
      </div>

      <div class="space-y-2.5 border-b border-surface-200 p-3 dark:border-surface-800">
        <label class="relative block">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-surface-400" />
          <input
            v-model="search"
            type="search"
            placeholder="Search candidates or roles"
            class="h-10 w-full rounded-lg border border-surface-300 bg-surface-50 pl-9 pr-3 text-sm text-surface-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
          />
        </label>

        <div
          v-if="isLocked"
          class="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-300"
        >
          <Briefcase class="size-3.5 shrink-0" />
          <span class="truncate">{{ lockedJobTitle }}</span>
        </div>
        <label v-else class="relative block">
          <Briefcase class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-surface-400" />
          <select
            v-model="jobFilter"
            class="h-10 w-full appearance-none rounded-lg border border-surface-300 bg-surface-50 pl-9 pr-9 text-sm text-surface-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
          >
            <option value="">All jobs</option>
            <option v-for="job in jobs" :key="job.id" :value="job.id">{{ job.title }}</option>
          </select>
          <ChevronDown class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-surface-400" />
        </label>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!billingResolved || (loadingList && conversations.length === 0)" class="animate-pulse space-y-px p-3">
          <div v-for="n in 6" :key="n" class="flex gap-3 px-1 py-2.5">
            <span class="size-9 shrink-0 rounded-full bg-surface-100 dark:bg-surface-800" />
            <span class="flex-1 space-y-2 py-1">
              <span class="block h-3 w-2/5 rounded bg-surface-100 dark:bg-surface-800" />
              <span class="block h-2.5 w-4/5 rounded bg-surface-100 dark:bg-surface-800" />
            </span>
          </div>
        </div>
        <div v-else-if="error" class="m-4 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/30 dark:text-danger-300">
          Inbox could not be loaded.
        </div>
        <div v-else-if="filteredConversations.length === 0" class="grid h-52 place-items-center px-6 text-center">
          <div>
            <span class="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-surface-100 dark:bg-surface-800">
              <Mail class="size-5 text-surface-400 dark:text-surface-500" />
            </span>
            <p class="text-sm font-medium text-surface-700 dark:text-surface-300">
              {{ search ? 'No matches' : 'No conversations yet' }}
            </p>
            <p class="mt-1 text-xs text-surface-400">
              {{ search ? 'Try a different name or role.' : 'Start one with the + button above.' }}
            </p>
          </div>
        </div>
        <button
          v-for="conversation in filteredConversations"
          :key="conversation.id"
          class="relative flex w-full gap-3 border-b border-surface-100 py-3 pl-4 pr-3 text-left transition-colors hover:bg-surface-50 dark:border-surface-800/70 dark:hover:bg-surface-900"
          :class="selectedId === conversation.id ? 'bg-brand-50/70 dark:bg-brand-950/20' : ''"
          @click="selectConversation(conversation)"
        >
          <span
            v-if="selectedId === conversation.id"
            class="absolute inset-y-0 left-0 w-0.5 bg-brand-600 dark:bg-brand-400"
          />
          <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {{ conversation.application.candidate.firstName.charAt(0) }}{{ conversation.application.candidate.lastName.charAt(0) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span
                v-if="conversation.unreadCount"
                class="size-1.5 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400"
              />
              <span class="truncate text-sm text-surface-900 dark:text-surface-100" :class="conversation.unreadCount ? 'font-semibold' : 'font-medium'">
                {{ conversationName(conversation) }}
              </span>
              <span class="ml-auto shrink-0 text-xs text-surface-400">{{ timeLabel(conversation.lastMessageAt) }}</span>
            </span>
            <span v-if="!isLocked" class="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">{{ conversation.application.job.title }}</span>
            <span class="mt-1 flex items-center gap-2">
              <span class="truncate text-xs" :class="conversation.unreadCount ? 'font-medium text-surface-600 dark:text-surface-300' : 'text-surface-500 dark:text-surface-400'">
                {{ conversation.messages[0]?.bodyText }}
              </span>
              <span v-if="conversation.unreadCount" class="ml-auto grid size-5 shrink-0 place-items-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">
                {{ conversation.unreadCount > 9 ? '9+' : conversation.unreadCount }}
              </span>
            </span>
          </span>
        </button>
      </div>
    </aside>

    <section class="min-w-0 flex-1 flex-col" :class="selectedId ? 'flex' : 'hidden md:flex'">
      <div v-if="loadingConversation && !selected" class="grid flex-1 place-items-center text-sm text-surface-400">Loading conversation…</div>
      <template v-else-if="selected">
        <header class="flex h-16 shrink-0 items-center gap-3 border-b border-surface-200 px-4 dark:border-surface-800 sm:px-5">
          <button class="grid size-9 place-items-center rounded-lg text-surface-500 hover:bg-surface-100 md:hidden dark:hover:bg-surface-800" title="Back" @click="closeThreadOnMobile">
            <ArrowLeft class="size-4" />
          </button>
          <span class="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
            {{ selected.application.candidate.firstName.charAt(0) }}{{ selected.application.candidate.lastName.charAt(0) }}
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold text-surface-900 dark:text-surface-100">{{ formatCandidateName(selected.application.candidate) }}</h2>
            <NuxtLink :to="$localePath(`/dashboard/applications/${selected.application.id}`)" class="block truncate text-xs text-brand-600 hover:underline dark:text-brand-400">
              {{ selected.application.job.title }}
            </NuxtLink>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto bg-surface-50 px-4 py-6 dark:bg-surface-950 sm:px-6">
          <div class="mx-auto flex max-w-3xl flex-col gap-1.5">
            <template
              v-for="(message, index) in selected.messages"
              :key="message.id"
            >
              <div v-if="isNewDay(index)" class="my-3 flex items-center gap-3 first:mt-0">
                <span class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
                <span class="text-[11px] font-medium uppercase tracking-wide text-surface-400">{{ dayLabel(message.createdAt) }}</span>
                <span class="h-px flex-1 bg-surface-200 dark:bg-surface-800" />
              </div>
              <article
                class="flex flex-col"
                :class="message.direction === 'outbound' ? 'items-end' : 'items-start'"
              >
                <span v-if="candidateMessageKindLabel(message.kind)" class="mb-1 max-w-[88%] px-1 text-[11px] font-semibold uppercase text-surface-400 sm:max-w-[76%]">
                  {{ candidateMessageKindLabel(message.kind) }}
                </span>
                <div
                  class="max-w-[88%] px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap shadow-sm sm:max-w-[76%]"
                  :class="message.direction === 'outbound'
                    ? 'rounded-2xl rounded-br-md bg-brand-600 text-white'
                    : 'rounded-2xl rounded-bl-md border border-surface-200 bg-white text-surface-800 dark:border-surface-800 dark:bg-surface-900 dark:text-surface-200'"
                >{{ message.bodyText }}</div>
                <CandidateMessageAttachmentList
                  :attachments="message.attachments"
                  :outbound="message.direction === 'outbound'"
                />
                <div class="mt-1 flex max-w-[88%] items-center gap-1.5 px-1 text-xs text-surface-400 sm:max-w-[76%]">
                  <span>{{ messageTime(message.createdAt) }}</span>
                  <template v-if="message.direction === 'outbound'">
                    <span class="text-surface-300 dark:text-surface-700">·</span>
                    <component :is="statusMeta[message.status].icon" class="size-3.5" :class="statusMeta[message.status].class" />
                    <span :class="statusMeta[message.status].class">{{ statusMeta[message.status].label }}</span>
                    <button
                      v-if="['failed', 'bounced'].includes(message.status)"
                      class="font-medium text-brand-600 hover:underline dark:text-brand-400"
                      :disabled="isSending"
                      @click="retryMessage(message)"
                    >Retry</button>
                  </template>
                </div>
                <p v-if="message.errorMessage" class="mt-1 max-w-[76%] px-1 text-xs text-danger-600 dark:text-danger-400">{{ message.errorMessage }}</p>
              </article>
            </template>
          </div>
        </div>

        <form class="shrink-0 border-t border-surface-200 bg-white p-3 dark:border-surface-800 dark:bg-surface-950 sm:p-4" @submit.prevent="submitReply">
          <div class="mx-auto max-w-3xl">
            <CandidateMessagePendingAttachments
              :files="replyAttachments"
              :disabled="isSending"
              @remove="removeReplyAttachment"
            />
            <div class="flex items-end gap-2">
              <label
                class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-surface-300 text-surface-500 transition-colors hover:bg-surface-100 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800"
                title="Attach files"
              >
                <Paperclip class="size-4" />
                <input
                  type="file"
                  multiple
                  class="sr-only"
                  :accept="CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT"
                  :disabled="isSending || replyAttachments.length >= CANDIDATE_MESSAGE_MAX_ATTACHMENTS"
                  @change="addReplyAttachments"
                />
              </label>
              <textarea
                v-model="replyBody"
                rows="2"
                maxlength="20000"
                placeholder="Write a reply…"
                class="max-h-40 min-h-12 flex-1 resize-y rounded-lg border border-surface-300 bg-white px-3 py-2.5 text-sm text-surface-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100"
                @input="replyRequestId = null"
                @keydown="onReplyKeydown"
              />
              <button
                type="submit"
                title="Send reply"
                class="grid size-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isSending || !replyBody.trim()"
              >
                <RefreshCw v-if="isSending" class="size-4 animate-spin" />
                <Send v-else class="size-4" />
              </button>
            </div>
            <p class="mt-1.5 px-1 text-[11px] text-surface-400">
              <template v-if="allowance.remaining != null">{{ allowance.remaining }} of {{ allowance.limit }} free conversations remaining. Replies are unlimited. </template>
              Press <kbd class="rounded border border-surface-300 bg-surface-50 px-1 font-sans text-[10px] text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400">⌘</kbd>
              <kbd class="rounded border border-surface-300 bg-surface-50 px-1 font-sans text-[10px] text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400">Enter</kbd> to send
            </p>
          </div>
        </form>
      </template>
      <div v-else class="grid flex-1 place-items-center bg-surface-50 px-6 text-center dark:bg-surface-950">
        <div>
          <span class="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-white shadow-sm ring-1 ring-surface-200 dark:bg-surface-900 dark:ring-surface-800">
            <Inbox class="size-6 text-brand-500 dark:text-brand-400" />
          </span>
          <p class="text-sm font-semibold text-surface-700 dark:text-surface-300">Select a conversation</p>
          <p class="mt-1 text-xs text-surface-400">Pick a candidate from the left to read and reply.</p>
        </div>
      </div>
    </section>
  </div>

  <Teleport to="body">
    <div v-if="showCompose" class="fixed inset-0 z-[70] grid place-items-center bg-surface-950/50 p-4" @click.self="showCompose = false">
      <form class="w-full max-w-xl rounded-lg border border-surface-200 bg-white shadow-2xl dark:border-surface-700 dark:bg-surface-900" @submit.prevent="submitCompose">
        <header class="flex h-14 items-center justify-between border-b border-surface-200 px-4 dark:border-surface-800">
          <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">New message</h2>
          <button type="button" title="Close" class="grid size-8 place-items-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800" @click="showCompose = false">
            <X class="size-4" />
          </button>
        </header>
        <div class="space-y-4 p-4">
          <label class="block">
            <span class="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Application</span>
            <select v-model="compose.applicationId" required class="h-10 w-full rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 outline-none focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100">
              <option value="" disabled>Select an application</option>
              <option v-for="application in applications" :key="application.id" :value="application.id">
                {{ application.candidateFirstName }} {{ application.candidateLastName }} — {{ application.jobTitle }}
              </option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Subject</span>
            <input v-model="compose.subject" required maxlength="300" class="h-10 w-full rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-900 outline-none focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100" @input="composeRequestId = null" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Message</span>
            <textarea v-model="compose.body" required rows="8" maxlength="20000" class="w-full resize-y rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none focus:border-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100" @input="composeRequestId = null" />
          </label>
          <CandidateMessagePendingAttachments
            :files="composeAttachments"
            :disabled="isSending"
            @remove="removeComposeAttachment"
          />
        </div>
        <footer class="flex items-center justify-end gap-2 border-t border-surface-200 px-4 py-3 dark:border-surface-800">
          <label
            class="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-surface-300 text-surface-500 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-400 dark:hover:bg-surface-800"
            title="Attach files"
          >
            <Paperclip class="size-4" />
            <input
              type="file"
              multiple
              class="sr-only"
              :accept="CANDIDATE_MESSAGE_ATTACHMENT_ACCEPT"
              :disabled="isSending || composeAttachments.length >= CANDIDATE_MESSAGE_MAX_ATTACHMENTS"
              @change="addComposeAttachments"
            />
          </label>
          <p v-if="allowance.limit != null" class="mr-auto text-xs text-surface-500 dark:text-surface-400">
            Uses 1 of <span class="font-semibold text-surface-700 dark:text-surface-200">{{ allowance.remaining }}</span> free conversations left. Replies stay unlimited.
          </p>
          <button type="button" class="rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800" @click="showCompose = false">Cancel</button>
          <button type="submit" class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50" :disabled="isSending || !compose.applicationId || !compose.subject.trim() || !compose.body.trim()">
            <RefreshCw v-if="isSending" class="size-4 animate-spin" />
            <Send v-else class="size-4" />
            Send
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>
