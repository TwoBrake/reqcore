import { eq, and, asc, inArray } from 'drizzle-orm'
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

    const updated = await db.update(application)
      .set({ status: match.action, autoRule: match, updatedAt: new Date() })
      .where(and(
        eq(application.id, applicationId),
        eq(application.organizationId, organizationId),
        // Guard against a concurrent manual change between read and write.
        eq(application.status, 'new'),
      ))
      .returning({ id: application.id })

    // The guard matched no rows — a recruiter changed status between our read and
    // write. Nothing was applied, so report no match (avoids over-counting and
    // skipping auto-scoring for a rejection that never happened).
    if (updated.length === 0) return null

    logInfo('application.auto_categorized', {
      application_id: applicationId,
      job_id: app.jobId,
      rule_id: match.ruleId,
      rule_name: match.ruleName,
      action: match.action,
    })

    // Mirror the manual status-change audit trail (applications/[id].patch.ts)
    // with a null (system) actor so auto changes appear in the timeline.
    recordActivity({
      organizationId,
      actorId: null,
      action: 'status_changed',
      resourceType: 'application',
      resourceId: applicationId,
      metadata: { from: 'new', to: match.action, ruleId: match.ruleId, ruleName: match.ruleName },
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

export interface ApplyRulesBatchResult {
  evaluated: number
  matched: number
  byAction: Record<string, number>
}

// Cap how many `new` applications a single retroactive run touches. Keeps the
// request bounded on the high-volume ICP; callers can re-invoke to drain the
// rest since only `new` applications are ever re-selected.
const RUN_BATCH_LIMIT = 2000
// Bound concurrent status writes so a large batch doesn't exhaust the DB pool.
const WRITE_CONCURRENCY = 20

/**
 * Retroactively evaluate a job's rule set against every application still in
 * `new`, in a single batch. Unlike calling {@link applyRulesToApplication} per
 * application, the rules and question-type lookups are fetched once and every
 * application's responses are loaded in one grouped query — turning a 4×N query
 * N+1 into a constant number of reads. Writes are per matched application (to
 * preserve per-application `autoRule` attribution) but run with bounded
 * concurrency and only for applications that actually matched.
 *
 * Processes at most {@link RUN_BATCH_LIMIT} applications per call; re-invoke to
 * continue draining a very large backlog.
 */
export async function applyRulesToNewJobApplications(
  jobId: string,
  organizationId: string,
): Promise<ApplyRulesBatchResult> {
  const empty: ApplyRulesBatchResult = { evaluated: 0, matched: 0, byAction: {} }

  // Rules — fetched once for the whole batch.
  const rules = await db
    .select()
    .from(applicationRule)
    .where(and(
      eq(applicationRule.jobId, jobId),
      eq(applicationRule.organizationId, organizationId),
      eq(applicationRule.enabled, true),
    ))
    .orderBy(asc(applicationRule.displayOrder))

  if (rules.length === 0) return empty

  const evaluated: EvaluatedRule[] = rules.map(r => ({
    id: r.id,
    name: r.name,
    matchType: r.matchType,
    action: r.action,
    enabled: r.enabled,
    conditions: r.conditions,
  }))

  // Question types — fetched once for the whole batch.
  const questions = await db
    .select({ id: jobQuestion.id, type: jobQuestion.type })
    .from(jobQuestion)
    .where(and(
      eq(jobQuestion.jobId, jobId),
      eq(jobQuestion.organizationId, organizationId),
    ))

  const questionTypesById: Record<string, QuestionType> = {}
  for (const q of questions) questionTypesById[q.id] = q.type as QuestionType

  // Applications still sitting in `new`, capped to keep the request bounded.
  const newApps = await db
    .select({ id: application.id })
    .from(application)
    .where(and(
      eq(application.jobId, jobId),
      eq(application.organizationId, organizationId),
      eq(application.status, 'new'),
    ))
    .limit(RUN_BATCH_LIMIT)

  if (newApps.length === 0) return empty

  const appIds = newApps.map(a => a.id)

  // All responses for the batch in one query, grouped by application in memory.
  const responsesByApp = new Map<string, Record<string, ResponseValue>>()
  for (const id of appIds) responsesByApp.set(id, {})
  const allResponses = await db
    .select({
      applicationId: questionResponse.applicationId,
      questionId: questionResponse.questionId,
      value: questionResponse.value,
    })
    .from(questionResponse)
    .where(and(
      inArray(questionResponse.applicationId, appIds),
      eq(questionResponse.organizationId, organizationId),
    ))
  for (const r of allResponses) {
    responsesByApp.get(r.applicationId)![r.questionId] = r.value as ResponseValue
  }

  const allowed = APPLICATION_STATUS_TRANSITIONS.new ?? []

  // Evaluate everything in memory first; collect the ones that need a write.
  const toWrite: Array<{ id: string, match: RuleMatch }> = []
  for (const app of newApps) {
    const match = evaluateApplicationRules(
      evaluated,
      responsesByApp.get(app.id) ?? {},
      questionTypesById,
    )
    if (!match) continue
    // Automation can't reach a status a recruiter couldn't reach from `new`.
    if (!allowed.includes(match.action)) continue
    toWrite.push({ id: app.id, match })
  }

  const byAction: Record<string, number> = {}
  let matched = 0

  // Per-application writes preserve `autoRule` attribution; bounded concurrency
  // keeps a large batch from exhausting the connection pool.
  for (let i = 0; i < toWrite.length; i += WRITE_CONCURRENCY) {
    const chunk = toWrite.slice(i, i + WRITE_CONCURRENCY)
    await Promise.all(chunk.map(async ({ id, match }) => {
      try {
        const updated = await db.update(application)
          .set({ status: match.action, autoRule: match, updatedAt: new Date() })
          .where(and(
            eq(application.id, id),
            eq(application.organizationId, organizationId),
            // Guard against a concurrent manual change between read and write.
            eq(application.status, 'new'),
          ))
          .returning({ id: application.id })

        // Guard matched no rows (concurrent manual change) — don't count or log it.
        if (updated.length === 0) return

        matched++
        byAction[match.action] = (byAction[match.action] ?? 0) + 1
        logInfo('application.auto_categorized', {
          application_id: id,
          job_id: jobId,
          rule_id: match.ruleId,
          rule_name: match.ruleName,
          action: match.action,
        })

        // Mirror the manual status-change audit trail with a null (system) actor.
        recordActivity({
          organizationId,
          actorId: null,
          action: 'status_changed',
          resourceType: 'application',
          resourceId: id,
          metadata: { from: 'new', to: match.action, ruleId: match.ruleId, ruleName: match.ruleName },
        })
      } catch (err) {
        logError('application.auto_categorize_failed', {
          application_id: id,
          error_message: err instanceof Error ? err.message : String(err),
        })
      }
    }))
  }

  return { evaluated: newApps.length, matched, byAction }
}
