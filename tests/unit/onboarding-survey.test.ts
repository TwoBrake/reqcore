import { describe, it, expect } from 'vitest'
import { SURVEY_QUESTIONS, SURVEY_PERSON_PROPS } from '../../shared/onboarding-survey'
import { saveOnboardingSurveySchema } from '../../server/utils/schemas/onboardingSurvey'

/**
 * The onboarding survey writes each answer to PostHog and to the
 * onboarding_survey_response table. Question ids and option values become stable
 * storage keys, so they must remain collision-free.
 */
describe('onboarding survey config', () => {
  it('asks the five expected questions', () => {
    expect(SURVEY_QUESTIONS.map(q => q.id)).toEqual([
      'company_size',
      'user_role',
      'discovery_source',
      'current_hiring_process',
      'expected_roles_12m',
    ])
  })

  it('has unique, non-empty question ids', () => {
    const ids = SURVEY_QUESTIONS.map(q => q.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/)
  })

  it('gives every question at least two options with unique values', () => {
    for (const q of SURVEY_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(2)
      const values = q.options.map(o => o.value)
      expect(new Set(values).size).toBe(values.length)
      for (const o of q.options) {
        expect(o.value.trim()).not.toBe('')
        expect(o.label.trim()).not.toBe('')
      }
    }
  })

  it('keeps answer keys distinct from the meta person-property keys', () => {
    const metaKeys = Object.values(SURVEY_PERSON_PROPS)
    for (const q of SURVEY_QUESTIONS) {
      expect(metaKeys).not.toContain(q.id)
    }
  })

  it('accepts valid partial survey persistence payloads', () => {
    const result = saveOnboardingSurveySchema.safeParse({
      plan: 'team',
      billing: 'annual',
      answers: {
        company_size: '11-50',
        user_role: 'people_hr',
        current_hiring_process: 'existing_ats',
        expected_roles_12m: '6-15',
      },
    })

    expect(result.success).toBe(true)
  })

  it('defaults an incremental save to not-completed', () => {
    // Per-answer saves omit `completed`; only the final step sends true. This
    // default is what keeps partial rows marked in-progress.
    const result = saveOnboardingSurveySchema.parse({
      answers: { company_size: 'solo' },
    })

    expect(result.completed).toBe(false)
  })

  it('accepts an explicit completion flag on the final save', () => {
    const result = saveOnboardingSurveySchema.parse({
      answers: { company_size: 'solo' },
      completed: true,
    })

    expect(result.completed).toBe(true)
  })

  it('rejects unknown questions and invalid option values before persistence', () => {
    expect(saveOnboardingSurveySchema.safeParse({
      answers: {
        company_size: 'enterprise',
      },
    }).success).toBe(false)

    expect(saveOnboardingSurveySchema.safeParse({
      answers: {
        unknown_question: 'anything',
      },
    }).success).toBe(false)
  })
})
