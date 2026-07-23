import { describe, it, expect } from 'vitest'
import {
  evaluateCondition,
  evaluateRule,
  evaluateApplicationRules,
  type EvaluatedRule,
  type QuestionType,
} from '~~/shared/application-rules'

describe('evaluateCondition', () => {
  it('handles presence operators', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'is_answered' }, 'hi', 'short_text')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_answered' }, '', 'short_text')).toBe(false)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_unanswered' }, undefined, 'short_text')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_unanswered' }, '  ', 'short_text')).toBe(true)
  })

  it('text equals/contains are case-insensitive and trimmed', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'equals', value: 'Yes' }, ' yes ', 'short_text')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'not_equals', value: 'Yes' }, 'no', 'short_text')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'contains', value: 'react' }, 'I love React', 'long_text')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'not_contains', value: 'react' }, 'Vue only', 'long_text')).toBe(true)
  })

  it('not_equals treats an unanswered field as not equal', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'not_equals', value: 'Yes' }, undefined, 'short_text')).toBe(true)
  })

  it('single-select membership', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'is_one_of', value: ['A', 'B'] }, 'a', 'single_select')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_not_one_of', value: ['A', 'B'] }, 'C', 'single_select')).toBe(true)
  })

  it('multi-select set operators', () => {
    const val = ['React', 'Node']
    expect(evaluateCondition({ questionId: 'q', operator: 'includes_any', value: ['node', 'go'] }, val, 'multi_select')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'includes_all', value: ['react', 'node'] }, val, 'multi_select')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'includes_all', value: ['react', 'go'] }, val, 'multi_select')).toBe(false)
    expect(evaluateCondition({ questionId: 'q', operator: 'includes_none', value: ['php'] }, val, 'multi_select')).toBe(true)
  })

  it('number comparisons', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'gte', value: 5 }, 5, 'number')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'lt', value: 3 }, 5, 'number')).toBe(false)
    expect(evaluateCondition({ questionId: 'q', operator: 'gt', value: 2 }, '5', 'number')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'gt', value: 2 }, 'abc', 'number')).toBe(false)
  })

  it('date comparisons', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'date_before', value: '2026-01-01' }, '2025-06-01', 'date')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'date_after', value: '2026-01-01' }, '2025-06-01', 'date')).toBe(false)
  })

  it('checkbox and file operators', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'is_true' }, true, 'checkbox')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_false' }, false, 'checkbox')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_provided' }, 'doc-id', 'file_upload')).toBe(true)
    expect(evaluateCondition({ questionId: 'q', operator: 'is_missing' }, undefined, 'file_upload')).toBe(true)
  })

  it('treats a deleted (unknown-type) question as non-matching', () => {
    expect(evaluateCondition({ questionId: 'q', operator: 'is_answered' }, 'x', undefined)).toBe(false)
  })
})

describe('evaluateRule matchType', () => {
  const types: Record<string, QuestionType> = { q1: 'short_text', q2: 'number' }

  it('ALL requires every condition', () => {
    const rule = {
      matchType: 'all' as const,
      conditions: [
        { questionId: 'q1', operator: 'equals' as const, value: 'yes' },
        { questionId: 'q2', operator: 'gte' as const, value: 3 },
      ],
    }
    expect(evaluateRule(rule, { q1: 'yes', q2: 5 }, types)).toBe(true)
    expect(evaluateRule(rule, { q1: 'yes', q2: 1 }, types)).toBe(false)
  })

  it('ANY requires only one condition', () => {
    const rule = {
      matchType: 'any' as const,
      conditions: [
        { questionId: 'q1', operator: 'equals' as const, value: 'yes' },
        { questionId: 'q2', operator: 'gte' as const, value: 3 },
      ],
    }
    expect(evaluateRule(rule, { q1: 'no', q2: 5 }, types)).toBe(true)
    expect(evaluateRule(rule, { q1: 'no', q2: 1 }, types)).toBe(false)
  })

  it('an empty condition list never matches', () => {
    expect(evaluateRule({ matchType: 'all', conditions: [] }, {}, types)).toBe(false)
  })
})

describe('evaluateApplicationRules ordering', () => {
  const types: Record<string, QuestionType> = { q1: 'single_select' }
  const rules: EvaluatedRule[] = [
    { id: 'r1', name: 'Disabled reject', enabled: false, matchType: 'all', action: 'rejected', conditions: [{ questionId: 'q1', operator: 'is_one_of', value: ['No'] }] },
    { id: 'r2', name: 'Reject no', enabled: true, matchType: 'all', action: 'rejected', conditions: [{ questionId: 'q1', operator: 'is_one_of', value: ['No'] }] },
    { id: 'r3', name: 'Advance yes', enabled: true, matchType: 'all', action: 'interview', conditions: [{ questionId: 'q1', operator: 'is_one_of', value: ['Yes'] }] },
  ]

  it('returns the first enabled matching rule', () => {
    expect(evaluateApplicationRules(rules, { q1: 'No' }, types)).toEqual({ ruleId: 'r2', ruleName: 'Reject no', action: 'rejected', matchedQuestionIds: ['q1'] })
    expect(evaluateApplicationRules(rules, { q1: 'Yes' }, types)).toEqual({ ruleId: 'r3', ruleName: 'Advance yes', action: 'interview', matchedQuestionIds: ['q1'] })
  })

  it('skips disabled rules and returns null when nothing matches', () => {
    expect(evaluateApplicationRules(rules, { q1: 'Maybe' }, types)).toBeNull()
  })
})
