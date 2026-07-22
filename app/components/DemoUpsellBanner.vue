<script setup lang="ts">
import { ArrowRight, ChevronUp, Minimize2, Sparkles } from 'lucide-vue-next'

const expanded = ref(false)
// Shared across layouts so the collapsed state survives navigation between
// pages that remount the banner (e.g. dashboard -> settings).
const collapsed = useState('demo-upsell-collapsed', () => false)
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed bottom-4 left-4 right-4 z-50 sm:right-auto"
      :class="collapsed ? 'sm:w-[260px]' : 'sm:w-[380px]'"
    >
      <button
        v-if="collapsed"
        type="button"
        class="group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-surface-200 bg-white/95 px-3.5 py-3 text-left shadow-2xl backdrop-blur-xl transition hover:border-brand-300 hover:bg-surface-50 dark:border-white/[0.08] dark:bg-surface-950/95 dark:hover:border-brand-400/30 dark:hover:bg-surface-900"
        @click="collapsed = false"
      >
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/25">
          <Sparkles class="size-4 text-white" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-semibold text-surface-950 dark:text-white">Start your workspace</span>
          <span class="block truncate text-[11px] text-surface-500 dark:text-white/45">Free or paid plan options</span>
        </span>
        <ChevronUp class="size-4 text-surface-400 transition group-hover:-translate-y-0.5 group-hover:text-surface-600 dark:text-white/35 dark:group-hover:text-white/70" />
      </button>

      <div
        v-else
        class="relative overflow-hidden rounded-xl ring-1 ring-inset ring-surface-200 bg-white shadow-2xl backdrop-blur-xl dark:ring-white/[0.08] dark:bg-surface-950 dark:bg-gradient-to-br dark:from-surface-950 dark:via-surface-900 dark:to-brand-950/90"
      >
        <div class="h-[2px] rounded-t-xl bg-gradient-to-r from-brand-400 via-accent-400 to-brand-500" />

        <div class="relative p-4">
          <div class="flex items-start gap-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 shadow-lg shadow-brand-500/25">
              <Sparkles class="size-4 text-white" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold text-surface-950 dark:text-white">Turn the demo into your workspace</p>
              <p class="mt-1 text-[11px] leading-5 text-surface-500 dark:text-white/50">
                Try free, or pick a paid plan and continue through signup with the plan already selected.
              </p>
            </div>
            <button
              type="button"
              class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-surface-200 bg-surface-50 text-surface-400 transition hover:border-surface-300 hover:bg-surface-100 hover:text-surface-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-white/35 dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07] dark:hover:text-white/70"
              title="Collapse signup options"
              @click="collapsed = true; expanded = false"
            >
              <Minimize2 class="size-3.5" />
            </button>
          </div>

          <div class="mt-3.5 space-y-2">
            <DemoSignupOptions compact @select="expanded = false" />

            <button
              type="button"
              class="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[12px] font-semibold text-surface-600 transition hover:border-surface-300 hover:bg-surface-100 hover:text-surface-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-white/70 dark:hover:border-white/[0.16] dark:hover:bg-white/[0.06] dark:hover:text-white"
              @click="expanded = !expanded"
            >
              {{ expanded ? 'Hide plan notes' : 'What happens next?' }}
              <ArrowRight class="size-3 transition-transform" :class="expanded ? 'rotate-90' : 'group-hover:translate-x-0.5'" />
            </button>
          </div>

          <Transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 -translate-y-1"
            leave-active-class="transition duration-100 ease-in"
            leave-to-class="opacity-0 -translate-y-1"
          >
            <div v-if="expanded" class="mt-3 rounded-lg border border-surface-200 bg-surface-50 p-3 text-[11px] leading-5 text-surface-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/55">
              Free starts immediately. Paid selections create your account first, then open secure checkout after your workspace is created.
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </Teleport>
</template>
