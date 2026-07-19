/**
 * Bulk Candidate Import — staging & commit service
 * ─────────────────────────────────────────────
 *
 * The DB-touching orchestration layer on top of the pure normalization core in
 * `candidate-import.ts`. Responsibilities:
 *
 *   • stageRows      — normalize + classify a file's rows (ready / duplicate /
 *                      duplicate_in_file / error) and (re)write them to staging.
 *   • buildPreview   — the review payload the UI renders before commit.
 *   • commitImport   — write ready rows to `candidate`, applying the chosen
 *                      duplicate policy. Idempotent + resumable per row.
 *
 * Nothing here mutates `candidate` until commitImport runs.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  application,
  candidate,
  importJob,
  importRow,
  job,
  propertyDefinition,
  propertyValue,
} from '../database/schema'
import {
  normalizeRow,
  computeDedupeHash,
  inferPropertyType,
  isPropertyTarget,
  propertyIdFromTarget,
  IMPORTABLE_PROPERTY_TYPES,
  type ColumnMapping,
  type ImportablePropertyType,
  type NormalizedPropertyValue,
  type PropertyTarget,
} from './candidate-import'

/** Insert rows in bounded chunks so a large file never builds one giant query. */
const INSERT_CHUNK = 1_000
/** Rows committed to `candidate` per batch — keeps transactions small + resumable. */
const COMMIT_CHUNK = 500
/** How many example rows the preview returns. */
const PREVIEW_SAMPLE = 50

type ImportRowStatus = typeof importRow.$inferInsert.status

export interface ImportSummary {
  total: number
  ready: number
  duplicate: number
  duplicateInFile: number
  error: number
  committed: number
  skipped: number
}

/**
 * Normalize + classify every row against the mapping and replace the job's
 * staged rows with the result. Existing-candidate duplicates are matched by
 * email in a single query; within-file duplicates are caught by first-seen
 * email. Safe to re-run whenever the mapping changes (pre-commit only).
 */
export async function stageRows(params: {
  orgId: string
  jobId: string
  rows: Record<string, string>[]
  mapping: ColumnMapping
}): Promise<void> {
  const { orgId, jobId, rows, mapping } = params

  const mappedProperties = Object.entries(mapping)
    .filter((entry): entry is [string, string] => isPropertyTarget(entry[1]))
  const propertyIds = [...new Set(mappedProperties.map(([, target]) => propertyIdFromTarget(target)))]
  const definitions = propertyIds.length
    ? await db.query.propertyDefinition.findMany({
        where: and(
          eq(propertyDefinition.organizationId, orgId),
          eq(propertyDefinition.entityType, 'candidate'),
          isNull(propertyDefinition.jobId),
          inArray(propertyDefinition.id, propertyIds),
        ),
      })
    : []
  const definitionsById = new Map(definitions.map(definition => [definition.id, definition]))
  const propertyTargets: PropertyTarget[] = mappedProperties.map(([column, target]) => {
    const definitionId = propertyIdFromTarget(target)
    const definition = definitionsById.get(definitionId)
    if (!definition || !IMPORTABLE_PROPERTY_TYPES.includes(definition.type as ImportablePropertyType)) {
      throw createError({ statusCode: 422, statusMessage: `Invalid candidate property mapping for ${column}` })
    }
    return {
      column,
      definitionId,
      type: definition.type as ImportablePropertyType,
      config: definition.config,
    }
  })

  const normalized = rows.map((raw, i) => ({
    raw,
    index: i,
    result: normalizeRow(raw, mapping, propertyTargets),
  }))

  // Look up which normalized emails already exist as candidates — one query.
  const readyEmails = [
    ...new Set(
      normalized
        .filter((n) => n.result.status === 'ready' && n.result.email)
        .map((n) => n.result.email as string),
    ),
  ]
  const existing = readyEmails.length
    ? await db.query.candidate.findMany({
        where: and(eq(candidate.organizationId, orgId), inArray(candidate.email, readyEmails)),
        columns: { id: true, email: true },
      })
    : []
  const existingByEmail = new Map(existing.map((c) => [c.email, c.id]))

  const seenInFile = new Set<string>()
  const values = normalized.map(({ raw, index, result }) => {
    let status: ImportRowStatus = result.status
    let dedupeHash: string | null = null
    let matchedCandidateId: string | null = null

    if (result.status === 'ready' && result.email) {
      dedupeHash = computeDedupeHash(orgId, result.email)
      const match = existingByEmail.get(result.email)
      if (match) {
        status = 'duplicate'
        matchedCandidateId = match
      }
      else if (seenInFile.has(result.email)) {
        status = 'duplicate_in_file'
      }
      else {
        seenInFile.add(result.email)
      }
    }

    return {
      organizationId: orgId,
      jobId,
      rowIndex: index,
      rawData: raw,
      // jsonb column is typed as an open record; our fixed shape widens cleanly.
      normalizedData: result.data
        ? { ...result.data, __properties: result.properties } as Record<string, unknown>
        : null,
      status,
      dedupeHash,
      matchedCandidateId,
      errorMessage: result.errorMessage,
    }
  })

  // Replace any prior staging for this job (re-map is idempotent).
  await db.delete(importRow).where(eq(importRow.jobId, jobId))
  for (let i = 0; i < values.length; i += INSERT_CHUNK) {
    await db.insert(importRow).values(values.slice(i, i + INSERT_CHUNK))
  }

  await db
    .update(importJob)
    .set({ mapping, totalRows: values.length, status: 'previewing', updatedAt: new Date() })
    .where(eq(importJob.id, jobId))
}

/** Count staged rows by status for a job. */
export async function summarizeJob(jobId: string): Promise<ImportSummary> {
  const counts = await db
    .select({ status: importRow.status, count: sql<number>`count(*)::int` })
    .from(importRow)
    .where(eq(importRow.jobId, jobId))
    .groupBy(importRow.status)

  const summary: ImportSummary = {
    total: 0, ready: 0, duplicate: 0, duplicateInFile: 0, error: 0, committed: 0, skipped: 0,
  }
  for (const { status, count } of counts) {
    summary.total += count
    if (status === 'ready') summary.ready = count
    else if (status === 'duplicate') summary.duplicate = count
    else if (status === 'duplicate_in_file') summary.duplicateInFile = count
    else if (status === 'error') summary.error = count
    else if (status === 'committed') summary.committed = count
    else if (status === 'skipped') summary.skipped = count
  }
  return summary
}

/** The full preview payload for the review screen. */
export async function buildPreview(importJobRow: typeof importJob.$inferSelect) {
  const [summary, sampleRows, targetJob, candidateProperties] = await Promise.all([
    summarizeJob(importJobRow.id),
    db.query.importRow.findMany({
      where: eq(importRow.jobId, importJobRow.id),
      orderBy: (r, { asc }) => [asc(r.rowIndex)],
      limit: PREVIEW_SAMPLE,
      columns: {
        id: true, rowIndex: true, status: true, rawData: true,
        normalizedData: true, errorMessage: true, matchedCandidateId: true,
      },
    }),
    importJobRow.targetJobId
      ? db.query.job.findFirst({
          where: eq(job.id, importJobRow.targetJobId),
          columns: { id: true, title: true },
        })
      : Promise.resolve(null),
    db.query.propertyDefinition.findMany({
      where: and(
        eq(propertyDefinition.organizationId, importJobRow.organizationId),
        eq(propertyDefinition.entityType, 'candidate'),
        isNull(propertyDefinition.jobId),
      ),
      orderBy: (definition, { asc }) => [asc(definition.displayOrder), asc(definition.createdAt)],
    }),
  ])
  const propertyTypeSuggestions = Object.fromEntries(
    (importJobRow.columns ?? []).map((column) => [
      column,
      inferPropertyType(sampleRows
        .map(row => row.rawData?.[column])
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')),
    ]),
  )
  return {
    job: {
      id: importJobRow.id,
      source: importJobRow.source,
      status: importJobRow.status,
      filename: importJobRow.filename,
      columns: importJobRow.columns ?? [],
      mapping: importJobRow.mapping ?? {},
      targetJobId: importJobRow.targetJobId,
      totalRows: importJobRow.totalRows,
      committedRows: importJobRow.committedRows,
      errorMessage: importJobRow.errorMessage,
      createdAt: importJobRow.createdAt,
    },
    targetJob: targetJob ?? null,
    candidateProperties: candidateProperties.filter(definition => (
      IMPORTABLE_PROPERTY_TYPES.includes(definition.type as ImportablePropertyType)
    )),
    propertyTypeSuggestions,
    summary,
    sampleRows,
  }
}

export interface CommitResult {
  created: number
  updated: number
  skipped: number
  /** Applications created linking rows to the target job (0 when none set). */
  applied: number
}

/**
 * Write staged rows to `candidate`. Idempotent and resumable: only rows still
 * awaiting commit are processed, inserts use ON CONFLICT DO NOTHING against the
 * unique (org, email) index, and each row is marked terminal (committed/skipped)
 * as it's handled — so a crashed commit resumes instead of double-inserting.
 *
 * When `targetJobId` is set, every row that resolves to a candidate (created or
 * an existing pool match) is also linked to that job as an application — this is
 * the "import these people as applicants to role X" flow. Application inserts use
 * ON CONFLICT DO NOTHING on (org, candidate, job), so linking is independent of
 * the candidate-pool duplicate policy and stays idempotent on re-import.
 */
export async function commitImport(params: {
  orgId: string
  jobId: string
  duplicatePolicy: 'skip' | 'update'
  targetJobId?: string | null
}): Promise<CommitResult> {
  const { orgId, jobId, duplicatePolicy, targetJobId } = params
  const result: CommitResult = { created: 0, updated: 0, skipped: 0, applied: 0 }

  const candidatePropertyDefinitions = await db.query.propertyDefinition.findMany({
    where: and(
      eq(propertyDefinition.organizationId, orgId),
      eq(propertyDefinition.entityType, 'candidate'),
      isNull(propertyDefinition.jobId),
    ),
    columns: { id: true },
  })
  const validPropertyIds = new Set(candidatePropertyDefinitions.map(definition => definition.id))

  async function writeProperties(candidateId: string, properties: NormalizedPropertyValue[]) {
    const validProperties = properties.filter(property => (
      typeof property?.definitionId === 'string' && validPropertyIds.has(property.definitionId)
    ))
    if (validProperties.length === 0) return
    await db.insert(propertyValue)
      .values(validProperties.map(property => ({
        organizationId: orgId,
        propertyDefinitionId: property.definitionId,
        entityType: 'candidate' as const,
        entityId: candidateId,
        value: property.value as never,
      })))
      .onConflictDoUpdate({
        target: [propertyValue.propertyDefinitionId, propertyValue.entityId],
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      })
  }

  /** Link a resolved candidate to the target job, if one was chosen. */
  async function linkToJob(candidateId: string) {
    if (!targetJobId) return
    const [app] = await db.insert(application)
      .values({ organizationId: orgId, candidateId, jobId: targetJobId, status: 'new' })
      .onConflictDoNothing({
        target: [application.organizationId, application.candidateId, application.jobId],
      })
      .returning({ id: application.id })
    if (app) result.applied++
  }

  await db.update(importJob).set({ status: 'committing', updatedAt: new Date() }).where(eq(importJob.id, jobId))

  // Rows within the file that duplicate an earlier row are never created.
  const dupInFile = await db
    .update(importRow)
    .set({ status: 'skipped' })
    .where(and(eq(importRow.jobId, jobId), eq(importRow.status, 'duplicate_in_file')))
    .returning({ id: importRow.id })
  result.skipped += dupInFile.length

  // Process the remaining actionable rows in bounded batches.
  for (;;) {
    const batch = await db.query.importRow.findMany({
      where: and(eq(importRow.jobId, jobId), inArray(importRow.status, ['ready', 'duplicate'])),
      orderBy: (r, { asc }) => [asc(r.rowIndex)],
      limit: COMMIT_CHUNK,
    })
    if (batch.length === 0) break

    for (const row of batch) {
      const data = row.normalizedData as {
        firstName: string; lastName: string; displayName: string | null; email: string
        phone: string | null; gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
        dateOfBirth: string | null; quickNotes: string | null
        __properties?: NormalizedPropertyValue[]
      } | null

      // Defensive: a row without normalized data can't be committed.
      if (!data) {
        await db.update(importRow).set({ status: 'skipped' }).where(eq(importRow.id, row.id))
        result.skipped++
        continue
      }
      const properties = Array.isArray(data.__properties) ? data.__properties : []

      // A prior attempt created this candidate and checkpointed its id before a
      // later property/application write failed. Resume those idempotent writes.
      if (row.status === 'ready' && row.createdCandidateId) {
        await writeProperties(row.createdCandidateId, properties)
        await linkToJob(row.createdCandidateId)
        await db.update(importRow)
          .set({ status: 'committed' })
          .where(eq(importRow.id, row.id))
        result.created++
        continue
      }

      if (row.status === 'duplicate') {
        // Matches an existing pool candidate. The policy governs the pool record;
        // the person is still linked to the target job either way.
        if (duplicatePolicy === 'update' && row.matchedCandidateId) {
          await db.update(candidate)
            .set({
              firstName: data.firstName,
              lastName: data.lastName,
              displayName: data.displayName,
              phone: data.phone,
              gender: data.gender,
              dateOfBirth: data.dateOfBirth,
              quickNotes: data.quickNotes,
              updatedAt: new Date(),
            })
            .where(and(eq(candidate.id, row.matchedCandidateId), eq(candidate.organizationId, orgId)))
          await writeProperties(row.matchedCandidateId, properties)
          await db.update(importRow)
            .set({ status: 'committed', createdCandidateId: row.matchedCandidateId })
            .where(eq(importRow.id, row.id))
          result.updated++
        }
        else {
          await db.update(importRow)
            .set({ status: 'skipped', createdCandidateId: row.matchedCandidateId })
            .where(eq(importRow.id, row.id))
          result.skipped++
        }
        if (row.matchedCandidateId) await linkToJob(row.matchedCandidateId)
        continue
      }

      // status === 'ready' → create. ON CONFLICT guards against a candidate
      // created since staging (or a concurrent commit) with the same email.
      const [inserted] = await db.insert(candidate)
        .values({
          organizationId: orgId,
          firstName: data.firstName,
          lastName: data.lastName,
          displayName: data.displayName,
          email: data.email,
          phone: data.phone,
          gender: data.gender,
          dateOfBirth: data.dateOfBirth,
          quickNotes: data.quickNotes,
        })
        .onConflictDoNothing({ target: [candidate.organizationId, candidate.email] })
        .returning({ id: candidate.id })

      if (inserted) {
        // Checkpoint first so a retry can finish property/application writes
        // without treating this candidate as an unrelated concurrent insert.
        await db.update(importRow)
          .set({ createdCandidateId: inserted.id })
          .where(eq(importRow.id, row.id))
        await writeProperties(inserted.id, properties)
        await linkToJob(inserted.id)
        await db.update(importRow)
          .set({ status: 'committed' })
          .where(eq(importRow.id, row.id))
        result.created++
      }
      else {
        // A candidate with this email already exists (raced in since staging).
        // Don't touch their record, but still link them to the target job.
        const existing = await db.query.candidate.findFirst({
          where: and(eq(candidate.organizationId, orgId), eq(candidate.email, data.email)),
          columns: { id: true },
        })
        await db.update(importRow)
          .set({ status: 'skipped', createdCandidateId: existing?.id ?? null })
          .where(eq(importRow.id, row.id))
        result.skipped++
        if (existing) await linkToJob(existing.id)
      }
    }

    await db.update(importJob)
      .set({ committedRows: sql`${importJob.committedRows} + ${batch.length}`, updatedAt: new Date() })
      .where(eq(importJob.id, jobId))
  }

  await db.update(importJob).set({ status: 'completed', updatedAt: new Date() }).where(eq(importJob.id, jobId))
  return result
}
