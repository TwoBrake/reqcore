<script setup lang="ts">
import {
  Check, ClipboardCopy, ExternalLink, Loader2, Mail, Power, RefreshCw, ShieldCheck,
} from 'lucide-vue-next'

const props = defineProps<{ jobId: string }>()
const localePath = useLocalePath()
const toast = useToast()

interface ForwardingStatus {
  available: boolean
  missing: string[]
  enabled: boolean
  address: string | null
  recent: Array<{
    id: string
    filename: string
    status: 'processing' | 'previewing' | 'committing' | 'completed' | 'failed'
    createdAt: string
    summary: { ready: number; duplicate: number; error: number; committed: number; skipped: number }
  }>
}

const { data, status, refresh } = await useFetch<ForwardingStatus>(
  `/api/jobs/${props.jobId}/candidate-forwarding`,
  { headers: useRequestHeaders(['cookie']), key: `candidate-forwarding-${props.jobId}` },
)
const updating = ref<'enable' | 'disable' | 'rotate' | null>(null)
const copied = ref(false)

async function update(action: 'enable' | 'disable' | 'rotate') {
  if (updating.value) return
  if (action === 'disable' && !window.confirm('Disable this forwarding address? New messages sent to it will be ignored.')) return
  if (action === 'rotate' && !window.confirm('Rotate this forwarding address? The current address will stop working immediately.')) return
  updating.value = action
  try {
    await $fetch(`/api/jobs/${props.jobId}/candidate-forwarding`, {
      method: 'PATCH',
      body: { action },
    })
    await refresh()
    toast.success(action === 'disable' ? 'Forwarding disabled' : action === 'rotate' ? 'Address rotated' : 'Forwarding enabled')
  }
  catch (error) {
    const err = error as { data?: { statusMessage?: string } }
    toast.error('Could not update forwarding', { message: err.data?.statusMessage ?? 'Please try again.' })
  }
  finally {
    updating.value = null
  }
}

async function copyAddress() {
  if (!data.value?.address) return
  try {
    await navigator.clipboard.writeText(data.value.address)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    toast.info(data.value.address)
  }
}

function statusLabel(item: ForwardingStatus['recent'][number]): string {
  if (item.status === 'completed') return 'Imported'
  if (item.status === 'failed') return 'Failed'
  if (item.summary.error > 0) return 'Needs correction'
  if (item.summary.duplicate > 0) return 'Duplicate found'
  return 'Ready for review'
}

function statusClasses(item: ForwardingStatus['recent'][number]): string {
  if (item.status === 'completed') return 'bg-success-50 text-success-700 dark:bg-success-950 dark:text-success-400'
  if (item.status === 'failed' || item.summary.error > 0) return 'bg-danger-50 text-danger-700 dark:bg-danger-950 dark:text-danger-400'
  if (item.summary.duplicate > 0) return 'bg-warning-50 text-warning-700 dark:bg-warning-950 dark:text-warning-400'
  return 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <section id="candidate-forwarding" class="mb-8 scroll-mt-6 rounded-xl border border-surface-200 bg-white p-6 dark:border-surface-800 dark:bg-surface-900">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex items-start gap-3">
        <div class="flex size-9 items-center justify-center rounded-lg bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
          <Mail class="size-4" />
        </div>
        <div>
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Email candidate forwarding</h2>
          <p class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">Forward candidate emails from Gmail to this job.</p>
        </div>
      </div>
      <span v-if="data?.enabled" class="inline-flex items-center gap-1.5 rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700 dark:bg-success-950 dark:text-success-400">
        <span class="size-1.5 rounded-full bg-success-500" />
        Active
      </span>
    </div>

    <div v-if="status === 'pending'" class="flex justify-center py-8">
      <Loader2 class="size-5 animate-spin text-surface-400" />
    </div>

    <div v-else-if="data && !data.available" class="mt-5 rounded-lg border border-warning-200 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-900 dark:bg-warning-950/30 dark:text-warning-300">
      Candidate forwarding requires the Resend receiving domain, receiving API key, and signed webhook configuration.
    </div>

    <div v-else-if="data?.enabled && data.address" class="mt-5 space-y-4">
      <div class="flex min-w-0 items-center gap-2">
        <input :value="data.address" readonly class="min-w-0 flex-1 rounded-lg border border-surface-300 bg-surface-50 px-3 py-2 font-mono text-xs text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200" />
        <button type="button" class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-surface-300 text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800" :title="copied ? 'Copied' : 'Copy forwarding address'" @click="copyAddress">
          <Check v-if="copied" class="size-4 text-success-600" />
          <ClipboardCopy v-else class="size-4" />
        </button>
        <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-surface-300 px-3 text-sm font-medium text-surface-700 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800">
          Gmail
          <ExternalLink class="size-3.5" />
        </a>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="inline-flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400">
          <ShieldCheck class="size-3.5" />
          Only active team members can forward to this address.
        </span>
        <div class="flex items-center gap-2">
          <button type="button" :disabled="!!updating" class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-surface-600 hover:bg-surface-100 disabled:opacity-50 dark:text-surface-300 dark:hover:bg-surface-800" @click="update('rotate')">
            <Loader2 v-if="updating === 'rotate'" class="size-3.5 animate-spin" />
            <RefreshCw v-else class="size-3.5" />
            Rotate
          </button>
          <button type="button" :disabled="!!updating" class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-danger-600 hover:bg-danger-50 disabled:opacity-50 dark:text-danger-400 dark:hover:bg-danger-950/30" @click="update('disable')">
            <Loader2 v-if="updating === 'disable'" class="size-3.5 animate-spin" />
            <Power v-else class="size-3.5" />
            Disable
          </button>
        </div>
      </div>
    </div>

    <div v-else class="mt-5">
      <button type="button" :disabled="!!updating" class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50" @click="update('enable')">
        <Loader2 v-if="updating === 'enable'" class="size-4 animate-spin" />
        <Mail v-else class="size-4" />
        Enable forwarding
      </button>
    </div>

    <div v-if="data?.recent.length" class="mt-6 border-t border-surface-200 pt-5 dark:border-surface-800">
      <h3 class="mb-3 text-xs font-medium uppercase text-surface-500">Recent forwarded candidates</h3>
      <div class="divide-y divide-surface-100 dark:divide-surface-800">
        <div v-for="item in data.recent" :key="item.id" class="flex min-w-0 items-center justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{{ item.filename }}</p>
            <p class="mt-0.5 text-xs text-surface-400">{{ formatDate(item.createdAt) }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="statusClasses(item)">{{ statusLabel(item) }}</span>
            <NuxtLink v-if="item.status === 'previewing'" :to="localePath(`/dashboard/candidates/import?id=${item.id}`)" class="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">Review</NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
