import { z } from 'zod'
import { BILLING_PLAN_IDS } from '../../../shared/billing'
import { SURVEY_QUESTIONS, type SurveyQuestionId } from '../../../shared/onboarding-survey'

const surveyQuestionIds = SURVEY_QUESTIONS.map(q => q.id) as [SurveyQuestionId, ...SurveyQuestionId[]]
const allowedValuesByQuestion = Object.fromEntries(
  SURVEY_QUESTIONS.map(q => [q.id, new Set(q.options.map(option => option.value))]),
) as Record<SurveyQuestionId, Set<string>>

export const surveyAnswersSchema = z.object({
  company_size: z.string().optional(),
  user_role: z.string().optional(),
  discovery_source: z.string().optional(),
  current_hiring_process: z.string().optional(),
  expected_roles_12m: z.string().optional(),
}).strict().superRefine((answers, ctx) => {
  for (const questionId of surveyQuestionIds) {
    const value = answers[questionId]
    if (value === undefined) continue

    if (!allowedValuesByQuestion[questionId].has(value)) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid answer for ${questionId}`,
        path: [questionId],
      })
    }
  }
})

export const saveOnboardingSurveySchema = z.object({
  answers: surveyAnswersSchema.default({}),
  plan: z.enum(['free', ...BILLING_PLAN_IDS]).optional(),
  billing: z.enum(['monthly', 'annual']).optional(),
  // Per-answer saves send `false`; only the final step sends `true`. This is
  // what flips completedAt from null to a timestamp in the upsert.
  completed: z.boolean().default(false),
})
