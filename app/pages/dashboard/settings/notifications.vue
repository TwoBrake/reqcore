<script setup lang="ts">
import { Bell, Save, Check, Loader2 } from 'lucide-vue-next'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  type NotificationChannelMode,
  type NotificationType,
} from '~~/shared/notifications'

definePageMeta({})

useSeoMeta({
  title: 'Notification Settings — Reqcore',
  description: 'Choose which recruiter events email you, and whether instantly or in a daily digest',
})

const { preferences, status, error, refresh, updatePreferences } = useNotificationPreferences()
const { track } = useTrack()
const localePath = useLocalePath()
const notificationsEnabled = useFeatureFlagEnabled('notifications')

watch(notificationsEnabled, (enabled) => {
  if (!enabled) void navigateTo(localePath('/dashboard/settings'))
}, { immediate: true })

const MODES: Array<{ value: NotificationChannelMode, label: string, hint: string }> = [
  { value: 'off', label: 'Off', hint: 'No email' },
  { value: 'instant', label: 'Instant', hint: 'Email right away' },
  { value: 'digest', label: 'Daily digest', hint: 'Once a day' },
]

// Local editable copy keyed by event type.
const local = ref<Record<NotificationType, NotificationChannelMode>>({
  candidate_replied: 'instant',
  application_created: 'digest',
  analysis_completed: 'instant',
})
const saved = ref<Record<NotificationType, NotificationChannelMode>>({ ...local.value })

watch(preferences, (prefs) => {
  for (const pref of prefs ?? []) {
    local.value[pref.type] = pref.channelMode
    saved.value[pref.type] = pref.channelMode
  }
}, { immediate: true })

const isReady = computed(() => status.value === 'success' && preferences.value.length === NOTIFICATION_TYPES.length)
const isDirty = computed(() => NOTIFICATION_TYPES.some(type => local.value[type] !== saved.value[type]))

const isSaving = ref(false)
const saveSuccess = ref(false)
const saveError = ref('')

async function handleSave() {
  if (!isReady.value || !isDirty.value) return
  isSaving.value = true
  saveError.value = ''
  saveSuccess.value = false
  try {
    await updatePreferences(
      NOTIFICATION_TYPES.map(type => ({ type, channelMode: local.value[type] })),
    )
    track('notification_preferences_saved')
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 3000)
  }
  catch (err: unknown) {
    saveError.value = err instanceof Error ? err.message : 'Failed to save preferences'
  }
  finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50">
        Notifications
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        Choose which events email you, and whether instantly or batched into a daily digest.
      </p>
    </div>

    <section class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 overflow-hidden">
      <div class="px-4 sm:px-6 py-5 border-b border-surface-200 dark:border-surface-800">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center size-10 shrink-0 rounded-lg bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400">
            <Bell class="size-5" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">Email notifications</h2>
            <p class="text-sm text-surface-500 dark:text-surface-400">These preferences apply to you in this organization.</p>
          </div>
        </div>
      </div>

      <div class="px-4 sm:px-6 py-5 space-y-6">
        <div v-if="status === 'pending'" class="space-y-4" aria-label="Loading notification preferences">
          <div v-for="type in NOTIFICATION_TYPES" :key="type" class="animate-pulse space-y-2">
            <div class="h-4 w-36 rounded bg-surface-200 dark:bg-surface-700" />
            <div class="h-10 rounded bg-surface-100 dark:bg-surface-800" />
          </div>
        </div>

        <div
          v-else-if="error"
          class="flex items-center justify-between gap-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-400"
        >
          <span>Could not load notification preferences.</span>
          <button class="font-medium underline" @click="refresh()">Retry</button>
        </div>

        <template v-else>
          <div
            v-for="type in NOTIFICATION_TYPES"
            :key="type"
          >
          <label class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">
            {{ NOTIFICATION_TYPE_META[type].label }}
          </label>
          <p class="text-xs text-surface-400 dark:text-surface-500 mb-3">
            {{ NOTIFICATION_TYPE_META[type].description }}
          </p>
          <div class="flex flex-col sm:flex-row gap-3">
            <label
              v-for="mode in MODES"
              :key="mode.value"
              class="flex items-start gap-3 flex-1 rounded-lg border p-3.5 cursor-pointer transition-colors"
              :class="local[type] === mode.value
                ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30 dark:border-brand-600'
                : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'"
            >
              <input
                v-model="local[type]"
                type="radio"
                :value="mode.value"
                :name="`mode-${type}`"
                class="mt-0.5 accent-brand-600"
              />
              <div>
                <span class="block text-sm font-medium text-surface-800 dark:text-surface-200">{{ mode.label }}</span>
                <span class="block text-xs text-surface-400 mt-0.5">{{ mode.hint }}</span>
              </div>
            </label>
          </div>
          </div>
        </template>

        <div
          v-if="saveError"
          class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 px-4 py-3 text-sm text-danger-700 dark:text-danger-400"
        >
          {{ saveError }}
        </div>

        <div class="flex items-center gap-3">
          <button
            :disabled="isSaving || !isReady || !isDirty"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleSave"
          >
            <Check v-if="saveSuccess" class="size-4" />
            <Loader2 v-else-if="isSaving" class="size-4 animate-spin" />
            <Save v-else class="size-4" />
            {{ saveSuccess ? 'Saved!' : isSaving ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
