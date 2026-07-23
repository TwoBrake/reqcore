<script setup lang="ts">
import { Columns2, Check } from 'lucide-vue-next'

const props = defineProps<{
  columns: { key: string; label: string; required?: boolean; group?: string }[]
  modelValue: Record<string, boolean>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, boolean>]
}>()

const open = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function toggle(key: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: !props.modelValue[key] })
}

function handleClickOutside(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

watch(open, (val) => {
  if (val) document.addEventListener('click', handleClickOutside)
  else document.removeEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const hiddenCount = computed(() =>
  props.columns.filter(col => !col.required && !props.modelValue[col.key]).length,
)

// Flatten into a render list, inserting a group header before the first column
// of each contiguous group (columns without a group render header-less).
type RenderItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'col'; key: string; col: (typeof props.columns)[number] }

const renderItems = computed<RenderItem[]>(() => {
  const items: RenderItem[] = []
  let lastGroup: string | undefined
  for (const col of props.columns) {
    if (col.group && col.group !== lastGroup) {
      items.push({ type: 'header', key: `header-${items.length}`, label: col.group })
    }
    lastGroup = col.group
    items.push({ type: 'col', key: `col-${col.key}`, col })
  }
  return items
})
</script>

<template>
  <div ref="menuRef" class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
      :class="hiddenCount > 0
        ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-300'
        : 'border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
      @click.stop="open = !open"
    >
      <Columns2 class="size-4" />
      Columns
      <span
        v-if="hiddenCount > 0"
        class="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-brand-600 text-white text-[10px] font-semibold"
      >{{ hiddenCount }}</span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg py-1"
    >
      <div class="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-800 mb-1">
        Toggle columns
      </div>
      <template v-for="item in renderItems" :key="item.key">
        <div
          v-if="item.type === 'header'"
          class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500"
        >
          {{ item.label }}
        </div>
        <button
          v-else
          type="button"
          class="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors"
          :class="item.col.required
            ? 'text-surface-400 dark:text-surface-500 cursor-not-allowed'
            : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'"
          :disabled="item.col.required"
          @click="!item.col.required && toggle(item.col.key)"
        >
          <span
            class="flex size-4 shrink-0 items-center justify-center rounded border transition-colors"
            :class="(item.col.required || modelValue[item.col.key])
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'border-surface-300 dark:border-surface-600'"
          >
            <Check v-if="item.col.required || modelValue[item.col.key]" class="size-3" />
          </span>
          {{ item.col.label }}
        </button>
      </template>
    </div>
  </div>
</template>
