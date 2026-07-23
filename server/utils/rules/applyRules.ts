import { eq, and, asc } from 'drizzle-orm'
import { application, applicationRule, jobQuestion, questionResponse } from '../../database/schema'
import {
  evaluateApplicationRules,
  type EvaluatedRule,
  type QuestionType,
  type ResponseValue,
  type RuleMatch,
} from '~~/shared/application-rules'
import { APPLICATION_STATUS_TRANSITIONS } from '~~/shared/status-transitions'

/**
 * Evaluate a job's automation rules against a single application's answers and,
 * if a rule matches, update the application status accordingly.
 *
 * Only acts on applications currently in `new` — rules classify fresh
 * applicants and must never override a status a recruiter has already advanced.
 * The target action is additionally checked against the manual transition rules
 * so automation can never reach a status a human couldn't from `new`.
 *
 * Returns the match that was applied, or null if nothing matched / no change.
 * Never throws — callers treat rule evaluation as best-effort.
 */
export async function applyRulesToApplication(
  applicationId: string,
  organizationId: string,
): Promise<RuleMatch | null> {
  try {
    const app = await db.query.application.findFirst({
      where: and(
        eq(application.id, applicationId),
        eq(application.organizationId, organizationId),
      ),
      columns: { id: true, jobId: true, status: true },
    })

    // Only classify applications still sitting in `new`.
    if (!app || app.status !== 'new') return null

    const rules = await db
      .select()
      .from(applicationRule)
      .where(and(
        eq(applicationRule.jobId, app.jobId),
        eq(applicationRule.organizationId, organizationId),
        eq(applicationRule.enabled, true),
      ))
      .orderBy(asc(applicationRule.displayOrder))

    if (rules.length === 0) return null

    // Question type lookup for the job (drives operator semantics).
    const questions = await db
      .select({ id: jobQuestion.id, type: jobQuestion.type })
      .from(jobQuestion)
      .where(and(
        eq(jobQuestion.jobId, app.jobId),
        eq(jobQuestion.organizationId, organizationId),
      ))

    const questionTypesById: Record<string, QuestionType> = {}
    for (const q of questions) questionTypesById[q.id] = q.type as QuestionType

    // Stored answers for this application (includes file_upload → documentId).
    const responses = await db
      .select({ questionId: questionResponse.questionId, value: questionResponse.value })
      .from(questionResponse)
      .where(and(
        eq(questionResponse.applicationId, applicationId),
        eq(questionResponse.organizationId, organizationId),
      ))

    const responsesByQuestionId: Record<string, ResponseValue> = {}
    for (const r of responses) responsesByQuestionId[r.questionId] = r.value as ResponseValue

    const evaluated: EvaluatedRule[] = rules.map(r => ({
      id: r.id,
      name: r.name,
      matchType: r.matchType,
      action: r.action,
      enabled: r.enabled,
      conditions: r.conditions,
    }))

    const match = evaluateApplicationRules(evaluated, responsesByQuestionId, questionTypesById)
    if (!match) return null

    // Respect the manual transition graph — automation can't reach a status a
    // recruiter couldn't reach from `new`.
    const allowed = APPLICATION_STATUS_TRANSITIONS.new ?? []
    if (!allowed.includes(match.action)) return null

    await db.update(application)
      .set({ status: match.action, autoRule: match, updatedAt: new Date() })
      .where(and(
        eq(application.id, applicationId),
        eq(application.organizationId, organizationId),
        // Guard against a concurrent manual change between read and write.
        eq(application.status, 'new'),
      ))

    logInfo('application.auto_categorized', {
      application_id: applicationId,
      job_id: app.jobId,
      rule_id: match.ruleId,
      rule_name: match.ruleName,
      action: match.action,
    })

    return match
  } catch (err) {
    logError('application.auto_categorize_failed', {
      application_id: applicationId,
      error_message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
