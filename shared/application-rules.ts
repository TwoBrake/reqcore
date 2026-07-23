/**
 * ─────────────────────────────────────────────
 * Application automation rules — single source of truth
 * ─────────────────────────────────────────────
 *
 * Recruiters configure per-job rules that read a candidate's application-form
 * answers and automatically set the application status on submit — the classic
 * ATS "knockout question" pattern (auto-reject) generalized to any status.
 *
 * A rule is an ordered list of conditions combined with `matchType` (all = AND,
 * any = OR) plus an `action` (the status to set). On a new application the rules
 * are evaluated in `displayOrder`; the FIRST enabled rule that matches wins and
 * its action is applied. Nothing matches → the application stays `new`.
 *
 * This module is imported by BOTH client and server so the operator catalogue,
 * labels, and the pure evaluator never drift between the builder UI and the
 * server that actually enforces the rules.
 */

// ─── Question types (mirrors questionTypeEnum in the DB schema) ─────
export type QuestionType =
  | 'short_text' | 'long_text' | 'single_select' | 'multi_select'
  | 'number' | 'date' | 'url' | 'checkbox' | 'file_upload'

/** A stored answer value, shaped by the question type. */
export type ResponseValue = string | string[] | number | boolean | null | undefined

// ─── Operators ─────────────────────────────────────────────────────
export type RuleOperator =
  // presence (any type)
  | 'is_answered' | 'is_unanswered'
  // text / url
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  // single_select
  | 'is_one_of' | 'is_not_one_of'
  // multi_select
  | 'includes_any' | 'includes_all' | 'includes_none'
  // number
  | 'gt' | 'gte' | 'lt' | 'lte'
  // date
  | 'date_before' | 'date_after' | 'date_on'
  // checkbox
  | 'is_true' | 'is_false'
  // file_upload
  | 'is_provided' | 'is_missing'

/** How the value input for an operator should be rendered in the builder. */
export type ValueInput = 'none' | 'text' | 'number' | 'date' | 'select' | 'multiselect'

export interface OperatorMeta {
  label: string
  valueInput: ValueInput
}

export const OPERATOR_META: Record<RuleOperator, OperatorMeta> = {
  is_answered: { label: 'is answered', valueInput: 'none' },
  is_unanswered: { label: 'is not answered', valueInput: 'none' },
  equals: { label: 'is exactly', valueInput: 'text' },
  not_equals: { label: 'is not', valueInput: 'text' },
  contains: { label: 'contains', valueInput: 'text' },
  not_contains: { label: 'does not contain', valueInput: 'text' },
  is_one_of: { label: 'is one of', valueInput: 'multiselect' },
  is_not_one_of: { label: 'is not one of', valueInput: 'multiselect' },
  includes_any: { label: 'includes any of', valueInput: 'multiselect' },
  includes_all: { label: 'includes all of', valueInput: 'multiselect' },
  includes_none: { label: 'includes none of', valueInput: 'multiselect' },
  gt: { label: 'is greater than', valueInput: 'number' },
  gte: { label: 'is at least', valueInput: 'number' },
  lt: { label: 'is less than', valueInput: 'number' },
  lte: { label: 'is at most', valueInput: 'number' },
  date_before: { label: 'is before', valueInput: 'date' },
  date_after: { label: 'is after', valueInput: 'date' },
  date_on: { label: 'is on', valueInput: 'date' },
  is_true: { label: 'is checked', valueInput: 'none' },
  is_false: { label: 'is not checked', valueInput: 'none' },
  is_provided: { label: 'is provided', valueInput: 'none' },
  is_missing: { label: 'is not provided', valueInput: 'none' },
}

/** Which operators are offered for each question type, in menu order. */
export const OPERATORS_BY_QUESTION_TYPE: Record<QuestionType, RuleOperator[]> = {
  short_text: ['equals', 'not_equals', 'contains', 'not_contains', 'is_answered', 'is_unanswered'],
  long_text: ['contains', 'not_contains', 'is_answered', 'is_unanswered'],
  url: ['contains', 'not_contains', 'equals', 'is_answered', 'is_unanswered'],
  single_select: ['is_one_of', 'is_not_one_of', 'is_answered', 'is_unanswered'],
  multi_select: ['includes_any', 'includes_all', 'includes_none', 'is_answered', 'is_unanswered'],
  number: ['gt', 'gte', 'lt', 'lte', 'is_answered', 'is_unanswered'],
  date: ['date_before', 'date_after', 'date_on', 'is_answered', 'is_unanswered'],
  checkbox: ['is_true', 'is_false'],
  file_upload: ['is_provided', 'is_missing'],
}

/** All valid operators — used for Zod validation. */
export const ALL_OPERATORS = Object.keys(OPERATOR_META) as RuleOperator[]

// ─── Actions ───────────────────────────────────────────────────────
// Restricted to statuses reachable from `new` (see shared/status-transitions.ts)
// so an automated jump never violates the manual transition rules.
export const RULE_ACTIONS = ['rejected', 'screening', 'interview'] as const
export type RuleAction = typeof RULE_ACTIONS[number]

export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
  rejected: 'Reject',
  screening: 'Move to Screening',
  interview: 'Move to Interview',
}

export type RuleMatchType = 'all' | 'any'

// ─── Rule shapes ───────────────────────────────────────────────────
export interface RuleCondition {
  questionId: string
  operator: RuleOperator
  /** Comparison value — omitted for presence operators (valueInput === 'none'). */
  value?: string | string[] | number | null
}

export interface ApplicationRuleInput {
  name: string
  matchType: RuleMatchType
  action: RuleAction
  enabled: boolean
  conditions: RuleCondition[]
}

// ─────────────────────────────────────────────
// Pure evaluator — server-authoritative, also usable client-side.
// ─────────────────────────────────────────────

function toArray(v: ResponseValue): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (v === null || v === undefined || v === '') return []
  return [String(v)]
}

function isEmpty(v: ResponseValue): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** Case-insensitive equality for text comparisons. */
function eqText(a: unknown, b: unknown): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/**
 * Evaluate a single condition against a stored answer.
 *
 * `questionType` may be undefined when the referenced question has been deleted
 * — in that case the condition is treated as NOT matched (never fires a rule on
 * a dangling reference).
 */
export function evaluateCondition(
  condition: RuleCondition,
  response: ResponseValue,
  questionType: QuestionType | undefined,
): boolean {
  if (!questionType) return false

  const { operator, value } = condition

  switch (operator) {
    case 'is_answered':
    case 'is_provided':
      return !isEmpty(response)
    case 'is_unanswered':
    case 'is_missing':
      return isEmpty(response)

    case 'equals':
      return !isEmpty(response) && eqText(response, value)
    case 'not_equals':
      // Unanswered counts as "not equal to X".
      return isEmpty(response) || !eqText(response, value)
    case 'contains':
      return String(response ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())
    case 'not_contains':
      return !String(response ?? '').toLowerCase().includes(String(value ?? '').toLowerCase())

    case 'is_one_of': {
      const set = toArray(value as ResponseValue).map(s => s.toLowerCase())
      return set.includes(String(response ?? '').toLowerCase())
    }
    case 'is_not_one_of': {
      const set = toArray(value as ResponseValue).map(s => s.toLowerCase())
      return !set.includes(String(response ?? '').toLowerCase())
    }

    case 'includes_any': {
      const picked = toArray(response).map(s => s.toLowerCase())
      const want = toArray(value as ResponseValue).map(s => s.toLowerCase())
      return want.some(w => picked.includes(w))
    }
    case 'includes_all': {
      const picked = toArray(response).map(s => s.toLowerCase())
      const want = toArray(value as ResponseValue).map(s => s.toLowerCase())
      return want.length > 0 && want.every(w => picked.includes(w))
    }
    case 'includes_none': {
      const picked = toArray(response).map(s => s.toLowerCase())
      const want = toArray(value as ResponseValue).map(s => s.toLowerCase())
      return !want.some(w => picked.includes(w))
    }

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const n = typeof response === 'number' ? response : Number(response)
      const target = typeof value === 'number' ? value : Number(value)
      if (Number.isNaN(n) || Number.isNaN(target)) return false
      if (operator === 'gt') return n > target
      if (operator === 'gte') return n >= target
      if (operator === 'lt') return n < target
      return n <= target
    }

    case 'date_before':
    case 'date_after':
    case 'date_on': {
      const r = Date.parse(String(response ?? ''))
      const t = Date.parse(String(value ?? ''))
      if (Number.isNaN(r) || Number.isNaN(t)) return false
      if (operator === 'date_before') return r < t
      if (operator === 'date_after') return r > t
      return r === t
    }

    case 'is_true':
      return response === true || response === 'true'
    case 'is_false':
      return !(response === true || response === 'true')

    default:
      return false
  }
}

/**
 * Evaluate one rule against a map of answers.
 * `responsesByQuestionId` / `questionTypesById` are keyed by jobQuestion id.
 */
export function evaluateRule(
  rule: Pick<ApplicationRuleInput, 'matchType' | 'conditions'>,
  responsesByQuestionId: Record<string, ResponseValue>,
  questionTypesById: Record<string, QuestionType>,
): boolean {
  if (rule.conditions.length === 0) return false

  const results = rule.conditions.map(c =>
    evaluateCondition(c, responsesByQuestionId[c.questionId], questionTypesById[c.questionId]),
  )

  return rule.matchType === 'any' ? results.some(Boolean) : results.every(Boolean)
}

export interface EvaluatedRule extends Pick<ApplicationRuleInput, 'matchType' | 'conditions' | 'action' | 'enabled'> {
  id: string
  name: string
}

export interface RuleMatch {
  ruleId: string
  ruleName: string
  action: RuleAction
  /**
   * Question ids whose condition contributed to the match — for `all` every
   * condition's question, for `any` only the questions that passed. Lets the UI
   * attribute the automated status change to the exact responses that caused it.
   */
  matchedQuestionIds: string[]
}

/**
 * Evaluate an ordered list of rules and return the first enabled match, or null.
 * Rules must be pre-sorted by displayOrder.
 */
export function evaluateApplicationRules(
  rules: EvaluatedRule[],
  responsesByQuestionId: Record<string, ResponseValue>,
  questionTypesById: Record<string, QuestionType>,
): RuleMatch | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.conditions.length === 0) continue

    const results = rule.conditions.map(c => ({
      questionId: c.questionId,
      ok: evaluateCondition(c, responsesByQuestionId[c.questionId], questionTypesById[c.questionId]),
    }))
    const matched = rule.matchType === 'any' ? results.some(r => r.ok) : results.every(r => r.ok)
    if (!matched) continue

    // For "any", only the passing conditions triggered; for "all", they all did.
    const contributing = rule.matchType === 'any' ? results.filter(r => r.ok) : results
    const matchedQuestionIds = [...new Set(contributing.map(r => r.questionId))]
    return { ruleId: rule.id, ruleName: rule.name, action: rule.action, matchedQuestionIds }
  }
  return null
}
