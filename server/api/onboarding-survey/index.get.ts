import { eq } from 'drizzle-orm'
import { onboardingSurveyResponse } from '../../database/schema'

/**
 * Whether the current user has finished the onboarding survey.
 *
 * Partial rows are saved per answer, so the presence of a row means nothing on
 * its own — completedAt is the source of truth. The dashboard uses this to
 * decide whether to re-prompt users who abandoned (or never saw) the survey.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const userId = session.user.id

  const row = await db.query.onboardingSurveyResponse.findFirst({
    where: eq(onboardingSurveyResponse.userId, userId),
    columns: { completedAt: true },
  })

  return { completed: !!row?.completedAt }
})
