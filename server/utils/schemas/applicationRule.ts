import { z } from 'zod'
import { ALL_OPERATORS, RULE_ACTIONS } from '~~/shared/application-rules'
import type { RuleOperator } from '~~/shared/application-rules'

// ─────────────────────────────────────────────
// Application automation rule validation schemas
// ─────────────────────────────────────────────

const conditionSchema = z.object({
  questionId: z.string().min(1, 'Pick a question'),
  operator: z.enum(ALL_OPERATORS as [RuleOperator, ...RuleOperator[]]),
  // Comparison value — string, number, or list of option labels. Omitted for
  // presence operators (is_answered, is_provided, is_true, …).
  value: z.union([
    z.string().max(1000),
    z.number(),
    z.array(z.string().max(500)).max(50),
    z.null(),
  ]).optional(),
})

const ruleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  matchType: z.enum(['all', 'any']).default('all'),
  action: z.enum(RULE_ACTIONS),
  enabled: z.boolean().default(true),
  conditions: z.array(conditionSchema).min(1, 'Add at least one condition').max(20),
})

/** Bulk replace the full rule set for a job (atomic save from the builder). */
export const bulkRulesSchema = z.object({
  rules: z.array(ruleSchema).max(50),
})

/** Route param schema for job id */
export const ruleJobIdParamSchema = z.object({
  id: z.string().min(1),
})
