<script setup lang="ts">
import { Plus, Trash2, ChevronUp, ChevronDown, Zap, AlertTriangle, PlayCircle } from 'lucide-vue-next'
import {
  OPERATOR_META,
  OPERATORS_BY_QUESTION_TYPE,
  RULE_ACTIONS,
  RULE_ACTION_LABELS,
  type QuestionType,
  type RuleAction,
  type RuleMatchType,
  type RuleOperator,
  type ApplicationRuleInput,
  type RuleCondition,
} from '~~/shared/application-rules'
import type { ApplicationRule } from '~/composables/useApplicationRules'

interface FormQuestion {
  id: string
  label: string
  type: QuestionType
  options?: string[] | null
}

const props = defineProps<{
  questions: FormQuestion[]
  serverRules: ApplicationRule[]
  saving: boolean
  running: boolean
}>()

const emit = defineEmits<{
  save: [rules: ApplicationRuleInput[]]
  run: []
}>()

// ─────────────────────────────────────────────
// Local editable draft (each rule/condition carries a client key)
// ─────────────────────────────────────────────

interface DraftCondition extends RuleCondition {
  _key: string
}
interface DraftRule {
  _key: string
  name: string
  matchType: RuleMatchType
  action: RuleAction
  enabled: boolean
  conditions: DraftCondition[]
}

const key = () => crypto.randomUUID()

function toDraft(rules: ApplicationRule[]): DraftRule[] {
  return rules.map(r => ({
    _key: key(),
    name: r.name,
    matchType: r.matchType,
    action: r.action,
    enabled: r.enabled,
    conditions: (r.conditions ?? []).map(c => ({ ...c, _key: key() })),
  }))
}

const draft = ref<DraftRule[]>(toDraft(props.serverRules))

// Reset the draft whenever the server set changes (after a save/refresh).
watch(() => props.serverRules, (rules) => {
  draft.value = toDraft(rules)
}, { deep: true })

// ─────────────────────────────────────────────
// Dirty tracking — compare draft vs server (ignoring client keys)
// ─────────────────────────────────────────────

function toPayload(rules: DraftRule[]): ApplicationRuleInput[] {
  return rules.map(r => ({
    name: r.name.trim(),
    matchType: r.matchType,
    action: r.action,
    enabled: r.enabled,
    conditions: r.conditions.map(({ _key, ...c }) => c),
  }))
}

const serverPayload = computed(() => JSON.stringify(
  props.serverRules.map(r => ({
    name: r.name,
    matchType: r.matchType,
    action: r.action,
    enabled: r.enabled,
    conditions: (r.conditions ?? []).map(c => ({ questionId: c.questionId, operator: c.operator, value: c.value })),
  })),
))
const draftPayload = computed(() => JSON.stringify(toPayload(draft.value)))
const isDirty = computed(() => draftPayload.value !== serverPayload.value)

// ─────────────────────────────────────────────
// Question / operator helpers
// ─────────────────────────────────────────────

const questionMap = computed<Record<string, FormQuestion>>(() =>
  Object.fromEntries(props.questions.map(q => [q.id, q])),
)

function operatorsFor(questionId: string): RuleOperator[] {
  const q = questionMap.value[questionId]
  return q ? OPERATORS_BY_QUESTION_TYPE[q.type] : []
}

function valueInputFor(cond: DraftCondition): string {
  return OPERATOR_META[cond.operator]?.valueInput ?? 'none'
}

function optionsFor(questionId: string): string[] {
  return questionMap.value[questionId]?.options ?? []
}

function isMissingQuestion(questionId: string): boolean {
  return !!questionId && !questionMap.value[questionId]
}

// ─────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────

const canAdd = computed(() => props.questions.length > 0)

function addRule() {
  if (!canAdd.value) return
  const firstQ = props.questions[0]
  draft.value.push({
    _key: key(),
    name: `Rule ${draft.value.length + 1}`,
    matchType: 'all',
    action: 'rejected',
    enabled: true,
    conditions: firstQ ? [newCondition(firstQ.id)] : [],
  })
}

function newCondition(questionId: string): DraftCondition {
  const ops = questionId ? OPERATORS_BY_QUESTION_TYPE[questionMap.value[questionId]!.type] : []
  return { _key: key(), questionId, operator: ops[0] ?? 'is_answered', value: undefined }
}

function removeRule(idx: number) {
  draft.value.splice(idx, 1)
}

function moveRule(idx: number, dir: -1 | 1) {
  const target = idx + dir
  if (target < 0 || target >= draft.value.length) return
  const [item] = draft.value.splice(idx, 1)
  draft.value.splice(target, 0, item!)
}

function addCondition(rule: DraftRule) {
  const firstQ = props.questions[0]
  rule.conditions.push(newCondition(firstQ?.id ?? ''))
}

function removeCondition(rule: DraftRule, idx: number) {
  rule.conditions.splice(idx, 1)
}

// When the question changes, reset operator + value to valid defaults.
function onQuestionChange(cond: DraftCondition) {
  const ops = operatorsFor(cond.questionId)
  cond.operator = ops[0] ?? 'is_answered'
  cond.value = undefined
}

// When the operator changes, drop a value that no longer applies.
function onOperatorChange(cond: DraftCondition) {
  const kind = valueInputFor(cond)
  if (kind === 'none') cond.value = undefined
  else if (kind === 'multiselect' && !Array.isArray(cond.value)) cond.value = []
  else if (kind !== 'multiselect' && Array.isArray(cond.value)) cond.value = undefined
}

function toggleOption(cond: DraftCondition, option: string) {
  const arr = Array.isArray(cond.value) ? [...cond.value] : []
  const i = arr.indexOf(option)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(option)
  cond.value = arr
}

function isOptionSelected(cond: DraftCondition, option: string): boolean {
  return Array.isArray(cond.value) && cond.value.includes(option)
}

// ─────────────────────────────────────────────
// Validation + save
// ─────────────────────────────────────────────

const validationError = computed<string | null>(() => {
  for (const r of draft.value) {
    if (!r.name.trim()) return 'Every rule needs a name.'
    if (r.conditions.length === 0) return `"${r.name}" needs at least one condition.`
    for (const c of r.conditions) {
      if (!c.questionId || isMissingQuestion(c.questionId)) return `"${r.name}" references a deleted question — fix or remove it.`
      const kind = OPERATOR_META[c.operator]?.valueInput
      if (kind === 'text' && !String(c.value ?? '').trim()) return `"${r.name}" is missing a value.`
      if (kind === 'number' && (c.value === undefined || c.value === null || c.value === '')) return `"${r.name}" is missing a number.`
      if (kind === 'date' && !c.value) return `"${r.name}" is missing a date.`
      if (kind === 'multiselect' && (!Array.isArray(c.value) || c.value.length === 0)) return `"${r.name}" needs at least one option selected.`
    }
  }
  return null
})

const actionOptions = RULE_ACTIONS.map(a => ({ value: a, label: RULE_ACTION_LABELS[a] }))

const actionBadgeClass: Record<RuleAction, string> = {
  rejected: 'text-danger-600 dark:text-danger-400',
  screening: 'text-warning-600 dark:text-warning-400',
  interview: 'text-brand-600 dark:text-brand-400',
}

function handleSave() {
  if (validationError.value) return
  emit('save', toPayload(draft.value))
}

const selectClass = 'rounded-md border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-2.5 py-1.5 text-sm text-surface-800 dark:text-surface-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40'
const inputClass = selectClass + ' min-w-0'
</script>

<template>
  <div>
    <!-- Intro -->
    <div class="mb-5 flex items-start gap-3">
      <div class="mt-0.5 rounded-lg bg-brand-50 dark:bg-brand-950/50 p-2 ring-1 ring-inset ring-brand-100 dark:ring-brand-900">
        <Zap class="size-4 text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Automation rules</h2>
        <p class="mt-0.5 text-sm text-surface-500 dark:text-surface-400 max-w-2xl">
          Automatically set an applicant's status the moment they apply, based on their answers.
          Rules run top to bottom — the first one that matches wins.
        </p>
      </div>
    </div>

    <!-- No questions yet -->
    <div
      v-if="questions.length === 0"
      class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center"
    >
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Add a question to your
        <NuxtLink :to="$localePath(`/dashboard/jobs/${$route.params.id}/application-form`)" class="text-brand-600 dark:text-brand-400 underline">application form</NuxtLink>
        first — rules evaluate the answers to those questions.
      </p>
    </div>

    <template v-else>
      <!-- Empty state -->
      <div
        v-if="draft.length === 0"
        class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-8 text-center"
      >
        <p class="text-sm text-surface-500 dark:text-surface-400 mb-4">
          No rules yet. Create one to auto-reject or auto-advance applicants based on their answers.
        </p>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          @click="addRule"
        >
          <Plus class="size-4" /> Add your first rule
        </button>
      </div>

      <!-- Rule cards -->
      <div v-else class="space-y-4">
        <div
          v-for="(rule, ri) in draft"
          :key="rule._key"
          class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900"
          :class="{ 'opacity-60': !rule.enabled }"
        >
          <!-- Card header -->
          <div class="flex items-center gap-2 px-4 py-3 border-b border-surface-100 dark:border-surface-800">
            <input
              v-model="rule.name"
              type="text"
              placeholder="Rule name"
              class="flex-1 min-w-0 bg-transparent text-sm font-semibold text-surface-900 dark:text-surface-100 focus:outline-none placeholder:text-surface-400 placeholder:font-normal"
            />

            <!-- Enable toggle -->
            <button
              type="button"
              role="switch"
              :aria-checked="rule.enabled"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
              :class="rule.enabled ? 'bg-brand-600' : 'bg-surface-300 dark:bg-surface-700'"
              @click="rule.enabled = !rule.enabled"
            >
              <span class="inline-block size-4 transform rounded-full bg-white transition-transform" :class="rule.enabled ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>

            <div class="flex items-center">
              <button
                class="rounded p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 disabled:opacity-30 disabled:cursor-not-allowed"
                :disabled="ri === 0"
                title="Move up"
                @click="moveRule(ri, -1)"
              >
                <ChevronUp class="size-4" />
              </button>
              <button
                class="rounded p-1 text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 disabled:opacity-30 disabled:cursor-not-allowed"
                :disabled="ri === draft.length - 1"
                title="Move down"
                @click="moveRule(ri, 1)"
              >
                <ChevronDown class="size-4" />
              </button>
            </div>
            <button
              class="rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400"
              title="Delete rule"
              @click="removeRule(ri)"
            >
              <Trash2 class="size-4" />
            </button>
          </div>

          <!-- Conditions -->
          <div class="px-4 py-3 space-y-2.5">
            <div class="flex flex-wrap items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
              <span>Apply this rule when</span>
              <select v-model="rule.matchType" :class="selectClass" class="py-1">
                <option value="all">every condition below is met</option>
                <option value="any">at least one condition below is met</option>
              </select>
            </div>

            <div
              v-for="(cond, ci) in rule.conditions"
              :key="cond._key"
              class="flex flex-wrap items-center gap-2 rounded-lg bg-surface-50 dark:bg-surface-800/50 p-2"
            >
              <!-- Question -->
              <select
                :value="cond.questionId"
                :class="selectClass"
                @change="cond.questionId = ($event.target as HTMLSelectElement).value; onQuestionChange(cond)"
              >
                <option v-if="isMissingQuestion(cond.questionId)" :value="cond.questionId">⚠ Deleted question</option>
                <option v-for="q in questions" :key="q.id" :value="q.id">{{ q.label }}</option>
              </select>

              <!-- Operator -->
              <select
                v-model="cond.operator"
                :class="selectClass"
                @change="onOperatorChange(cond)"
              >
                <option v-for="op in operatorsFor(cond.questionId)" :key="op" :value="op">
                  {{ OPERATOR_META[op].label }}
                </option>
              </select>

              <!-- Value input -->
              <template v-if="valueInputFor(cond) === 'text'">
                <input v-model="cond.value" type="text" placeholder="value" :class="inputClass" class="flex-1" />
              </template>
              <template v-else-if="valueInputFor(cond) === 'number'">
                <input v-model.number="cond.value" type="number" placeholder="0" :class="inputClass" class="w-28" />
              </template>
              <template v-else-if="valueInputFor(cond) === 'date'">
                <input v-model="cond.value" type="date" :class="inputClass" />
              </template>
              <template v-else-if="valueInputFor(cond) === 'multiselect' || valueInputFor(cond) === 'select'">
                <!-- Option chips when the question defines options -->
                <div v-if="optionsFor(cond.questionId).length" class="flex flex-wrap items-center gap-1.5">
                  <button
                    v-for="opt in optionsFor(cond.questionId)"
                    :key="opt"
                    type="button"
                    class="rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors"
                    :class="isOptionSelected(cond, opt)
                      ? 'bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 ring-brand-300 dark:ring-brand-700'
                      : 'bg-white dark:bg-surface-900 text-surface-600 dark:text-surface-300 ring-surface-200 dark:ring-surface-700 hover:ring-surface-300'"
                    @click="toggleOption(cond, opt)"
                  >
                    {{ opt }}
                  </button>
                </div>
                <input
                  v-else
                  type="text"
                  placeholder="comma,separated,values"
                  :class="inputClass"
                  class="flex-1"
                  :value="Array.isArray(cond.value) ? cond.value.join(', ') : ''"
                  @input="cond.value = ($event.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)"
                />
              </template>

              <button
                class="ml-auto rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 shrink-0"
                title="Remove condition"
                @click="removeCondition(rule, ci)"
              >
                <Trash2 class="size-3.5" />
              </button>
            </div>

            <button
              class="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700"
              @click="addCondition(rule)"
            >
              <Plus class="size-3.5" /> Add condition
            </button>

            <!-- Missing-question warning -->
            <div
              v-if="rule.conditions.some(c => isMissingQuestion(c.questionId))"
              class="flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400"
            >
              <AlertTriangle class="size-3.5" />
              This rule references a question that was deleted from the form.
            </div>
          </div>

          <!-- Action -->
          <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-surface-100 dark:border-surface-800 text-sm">
            <span class="text-surface-500 dark:text-surface-400">Then set the applicant's status to</span>
            <span class="font-semibold" :class="actionBadgeClass[rule.action]">→</span>
            <select v-model="rule.action" :class="selectClass" class="font-semibold">
              <option v-for="a in actionOptions" :key="a.value" :value="a.value">{{ a.label }}</option>
            </select>
          </div>
        </div>

        <button
          class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3.5 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          @click="addRule"
        >
          <Plus class="size-4" /> Add rule
        </button>
      </div>

      <!-- Sticky save bar -->
      <div class="sticky bottom-0 z-10 mt-6 -mx-1 flex flex-wrap items-center gap-3 rounded-t-xl border-t border-surface-200 dark:border-surface-800 bg-white/90 dark:bg-surface-900/90 backdrop-blur px-4 py-3">
        <p v-if="validationError" class="text-xs text-danger-600 dark:text-danger-400">{{ validationError }}</p>
        <p v-else-if="isDirty" class="text-xs text-surface-500 dark:text-surface-400">You have unsaved changes.</p>
        <p v-else class="text-xs text-success-600 dark:text-success-500">All changes saved.</p>

        <div class="ml-auto flex items-center gap-2">
          <button
            v-if="!isDirty && serverRules.length > 0"
            :disabled="running"
            class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors disabled:opacity-50"
            title="Apply the saved rules to applicants already in New"
            @click="emit('run')"
          >
            <PlayCircle class="size-4" />
            {{ running ? 'Running…' : 'Run on existing applicants' }}
          </button>
          <button
            :disabled="!isDirty || !!validationError || saving"
            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleSave"
          >
            {{ saving ? 'Saving…' : 'Save rules' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
