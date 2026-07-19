import { sql } from 'drizzle-orm'
import { onboardingSurveyResponse } from '../../database/schema'
import { saveOnboardingSurveySchema } from '../../utils/schemas/onboardingSurvey'
import { SURVEY_QUESTIONS } from '../../../shared/onboarding-survey'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const body = await readValidatedBody(event, saveOnboardingSurveySchema.parse)

  const answeredCount = Object.values(body.answers).filter(Boolean).length
  const skippedCount = SURVEY_QUESTIONS.length - answeredCount
  const now = new Date()
  const completedAt = body.completed ? now : null

  const values = {
    userId,
    organizationId: orgId,
    signupPlan: body.plan ?? 'free',
    signupBilling: body.billing ?? null,
    companySize: body.answers.company_size ?? null,
    userRole: body.answers.user_role ?? null,
    discoverySource: body.answers.discovery_source ?? null,
    currentHiringProcess: body.answers.current_hiring_process ?? null,
    expectedRoles12m: body.answers.expected_roles_12m ?? null,
    answeredCount,
    skippedCount,
    completedAt,
    updatedAt: now,
  }

  const [saved] = await db
    .insert(onboardingSurveyResponse)
    .values(values)
    .onConflictDoUpdate({
      target: onboardingSurveyResponse.userId,
      set: {
        ...values,
        // A partial save must never wipe a completion that already landed
        // (e.g. an in-flight per-answer POST arriving after finish()).
        completedAt: body.completed
          ? now
          : sql`${onboardingSurveyResponse.completedAt}`,
      },
    })
    .returning({
      id: onboardingSurveyResponse.id,
      userId: onboardingSurveyResponse.userId,
      organizationId: onboardingSurveyResponse.organizationId,
      signupPlan: onboardingSurveyResponse.signupPlan,
      signupBilling: onboardingSurveyResponse.signupBilling,
      companySize: onboardingSurveyResponse.companySize,
      userRole: onboardingSurveyResponse.userRole,
      discoverySource: onboardingSurveyResponse.discoverySource,
      currentHiringProcess: onboardingSurveyResponse.currentHiringProcess,
      expectedRoles12m: onboardingSurveyResponse.expectedRoles12m,
      answeredCount: onboardingSurveyResponse.answeredCount,
      skippedCount: onboardingSurveyResponse.skippedCount,
      completedAt: onboardingSurveyResponse.completedAt,
      updatedAt: onboardingSurveyResponse.updatedAt,
    })

  if (!saved) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to save onboarding survey' })
  }

  logApiRequest(event, session, 'onboarding_survey.saved', {
    answeredCount,
    skippedCount,
    completed: body.completed,
  })

  return saved
})
