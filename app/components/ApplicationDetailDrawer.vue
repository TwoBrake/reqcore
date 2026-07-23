<script setup lang="ts">
import { X, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  applicationId: string
}>()

const emit = defineEmits<{
  close: []
  deleted: []
}>()

const localePath = useLocalePath()

// ─── Resize ───────────────────────────────────────────────────────────────────

const MIN_WIDTH = 384
const MAX_WIDTH = 1280
const drawerWidth = ref(940)
const isResizing = ref(false)

function startResize(e: MouseEvent) {
  e.preventDefault()
  isResizing.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const startX = e.clientX
  const startWidth = drawerWidth.value
  const onMove = (moveEvent: MouseEvent) => {
    const delta = startX - moveEvent.clientX
    drawerWidth.value = Math.min(Math.max(startWidth + delta, MIN_WIDTH), Math.min(MAX_WIDTH, window.innerWidth))
  }
  const onUp = () => {
    isResizing.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ─── Body scroll lock ─────────────────────────────────────────────────────────
// Escape handling (incl. closing this drawer) is owned by <ApplicationDetail>,
// which emits `close` once its own nested modals are dismissed.

onMounted(() => {
  document.body.style.overflow = 'hidden'
})

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop — dimmed but non-interactive so clicks pass through to the rows behind it -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div class="fixed inset-0 z-[55] bg-surface-900/40 pointer-events-none" />
    </Transition>

    <!-- Panel -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      leave-active-class="transition-transform duration-200 ease-in"
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
    >
      <aside
        class="fixed inset-y-0 right-0 z-[60] flex flex-col bg-white dark:bg-surface-900 shadow-2xl border-l border-surface-200 dark:border-surface-800"
        :style="{ width: `${drawerWidth}px`, maxWidth: '100vw' }"
        role="dialog"
        aria-modal="true"
        aria-label="Application detail"
      >
        <!-- Resize handle -->
        <div
          class="group absolute top-0 bottom-0 -left-1 w-2 cursor-col-resize z-10 flex items-center justify-center"
          @mousedown="startResize"
        >
          <div
            class="h-16 w-1 rounded-full bg-surface-300 dark:bg-surface-700 transition-colors group-hover:bg-brand-500"
            :class="{ 'bg-brand-500': isResizing }"
          />
        </div>

        <!-- Header -->
        <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-200 dark:border-surface-800 shrink-0">
          <span class="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">Application Detail</span>
          <div class="flex items-center gap-2 shrink-0">
            <NuxtLink
              :to="localePath(`/dashboard/applications/${applicationId}`)"
              class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
            >
              <ExternalLink class="size-3.5" />
              Open full page
            </NuxtLink>
            <button
              class="rounded-lg p-1.5 text-surface-500 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              @click="emit('close')"
            >
              <X class="size-4" />
            </button>
          </div>
        </header>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto p-5">
          <ApplicationDetail
            :application-id="applicationId"
            variant="drawer"
            @deleted="emit('deleted')"
            @close="emit('close')"
          />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
