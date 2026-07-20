/**
 * Fire-and-forget AI scoring for a single application.
 * Called when autoScoreOnApply is enabled on a job.
 * Silently skips if AI config, criteria, or candidate material are missing.
 */
import { eq, and } from 'drizzle-orm'
import {
  application, scoringCriterion, criterionScore,
  analysisRun, document,
} from '../../database/schema'
import { scoreApplication, computeCompositeScore, hasScorableCandidateMaterial } from './scoring'
import type { CriterionDefinition } from './scoring'
import { resolveAnalysisProvider } from './resolveProvider'
import { assertPlatformBudget } from './budget'
import { computeCostUsdMicros } from './pricing'
import { captureAiGeneration } from './observability'
import { extractResumeText } from '../resume-parser'
import { fetchScreeningAnswers, DEFAULT_ANALYSIS_CONTEXT } from './analysisContext'

export async function autoScoreApplication(applicationId: string, orgId: string) {
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    with: {
      candidate: { columns: { id: true, firstName: true, lastName: true } },
      job: { columns: { id: true, title: true, description: true, analysisContext: true } },
    },
  })
  if (!app) return

  let resolved
  try {
    resolved = await resolveAnalysisProvider(orgId)
  } catch {
    return
  }

  // Money-safety gate. Auto-scoring is fire-and-forget, so a budget breach just
  // silently skips — the user isn't waiting on a response. Only platform-paid.
  if (resolved.billingMode === 'platform') {
    try {
      await assertPlatformBudget(orgId)
    } catch {
      return
    }
  }

  const criteria = await db.select().from(scoringCriterion)
    .where(and(
      eq(scoringCriterion.jobId, app.job.id),
      eq(scoringCriterion.organizationId, orgId),
    ))
  if (criteria.length === 0) return

  const docs = await db.select({ parsedContent: document.parsedContent, type: document.type })
    .from(document)
    .where(and(eq(document.candidateId, app.candidate.id), eq(document.organizationId, orgId)))

  const resumeDoc = docs.find(d => d.type === 'resume')
  const resumeText = extractResumeText(resumeDoc?.parsedContent)

  if (!app.job.description) return

  const criteriaDefinitions: CriterionDefinition[] = criteria.map(c => ({
    key: c.key,
    name: c.name,
    description: c.description,
    category: c.category,
    maxScore: c.maxScore,
    weight: c.weight,
  }))

  const analysisContext = app.job.analysisContext ?? DEFAULT_ANALYSIS_CONTEXT
  const screeningAnswers = analysisContext.screeningAnswers
    ? await fetchScreeningAnswers(applicationId, orgId)
    : null
  const materials = {
    resumeText,
    coverLetterText: analysisContext.coverLetter ? app.coverLetterText : null,
    applicationNotes: analysisContext.recruiterNotes ? app.notes : null,
    screeningAnswers,
  }
  if (!hasScorableCandidateMaterial(materials)) return

  const startedAt = Date.now()
  let result
  try {
    result = await scoreApplication(resolved.providerConfig, {
      jobTitle: app.job.title,
      jobDescription: app.job.description,
      criteria: criteriaDefinitions,
      ...materials,
    })
  } catch (err: any) {
    await db.insert(analysisRun).values({
      organizationId: orgId,
      applicationId,
      status: 'failed',
      provider: resolved.provider,
      model: resolved.model,
      billingMode: resolved.billingMode,
      criteriaSnapshot: criteriaDefinitions as any,
      errorMessage: err?.message ?? 'Unknown error',
    })
    captureAiGeneration({
      orgId, applicationId, feature: 'application_analysis',
      provider: resolved.provider, model: resolved.model, billingMode: resolved.billingMode,
      promptTokens: 0, completionTokens: 0, costUsdMicros: null,
      latencyMs: Date.now() - startedAt, status: 'failed',
    })
    return
  }

  const compositeScore = computeCompositeScore(criteriaDefinitions, result.scoring.evaluations)
  const costUsdMicros = computeCostUsdMicros(
    resolved.model, result.usage.promptTokens, result.usage.completionTokens,
  )

  const scoreValues = result.scoring.evaluations.map(evaluation => ({
    organizationId: orgId,
    applicationId,
    criterionKey: evaluation.criterionKey,
    maxScore: evaluation.maxScore,
    applicantScore: evaluation.applicantScore,
    confidence: evaluation.confidence,
    evidence: evaluation.evidence,
    strengths: evaluation.strengths,
    gaps: evaluation.gaps,
  }))

  const [run] = await db.transaction(async (tx) => {
    await tx.delete(criterionScore)
      .where(and(
        eq(criterionScore.applicationId, applicationId),
        eq(criterionScore.organizationId, orgId),
      ))

    if (scoreValues.length > 0) {
      await tx.insert(criterionScore).values(scoreValues)
    }

    await tx.update(application)
      .set({ score: compositeScore, updatedAt: new Date() })
      .where(eq(application.id, applicationId))

    return tx.insert(analysisRun).values({
      organizationId: orgId,
      applicationId,
      status: 'completed',
      provider: resolved.provider,
      model: resolved.model,
      billingMode: resolved.billingMode,
      criteriaSnapshot: criteriaDefinitions as any,
      compositeScore,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costUsdMicros,
    }).returning({ id: analysisRun.id })
  })

  captureAiGeneration({
    orgId, applicationId, feature: 'application_analysis',
    provider: resolved.provider, model: resolved.model, billingMode: resolved.billingMode,
    promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
    costUsdMicros, latencyMs: Date.now() - startedAt, status: 'completed',
    traceId: run?.id,
  })
}
