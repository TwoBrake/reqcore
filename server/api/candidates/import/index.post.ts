import { fileTypeFromBuffer } from 'file-type'
import { and, eq } from 'drizzle-orm'
import { importJob, job as jobTable } from '../../../database/schema'
import { createRateLimiter } from '../../../utils/rateLimit'
import { parseCsv, autoMapColumns, MAX_IMPORT_ROWS } from '../../../utils/candidate-import'
import { stageRows, buildPreview } from '../../../utils/candidate-import-service'

/**
 * POST /api/candidates/import
 *
 * Upload a CSV of candidates. The file is parsed, staged into `import_row`,
 * auto-mapped to candidate fields and duplicate-classified — but NOTHING is
 * written to `candidate` yet. Returns the job + preview so the user can confirm
 * the column mapping and commit. See PRODUCT.md → "Bulk import".
 */
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many imports. Please wait a moment.',
})

/** 25 MB — a CSV this large already holds well over 100k rows. */
const IMPORT_MAX_BYTES = 25 * 1024 * 1024

const CSV_MIMES = new Set(['text/csv', 'application/csv', 'text/plain'])

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const form = await readMultipartFormData(event)
  const filePart = form?.find((p) => p.name === 'file')
  if (!filePart?.data || !filePart.filename) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  // Optional: link committed rows to a job as applications ("import as applicants").
  const targetJobId = form?.find((p) => p.name === 'jobId')?.data?.toString().trim() || null
  if (targetJobId) {
    const targetJob = await db.query.job.findFirst({
      where: and(eq(jobTable.id, targetJobId), eq(jobTable.organizationId, orgId)),
      columns: { id: true },
    })
    if (!targetJob) {
      throw createError({ statusCode: 404, statusMessage: 'Target job not found' })
    }
  }
  if (filePart.data.length > IMPORT_MAX_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: `File too large. Max ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`,
    })
  }

  // Accept by magic bytes when detectable, else fall back to extension — CSVs
  // frequently have no reliable signature and get sniffed as text/plain.
  const detected = await fileTypeFromBuffer(filePart.data)
  const isCsv = filePart.filename.toLowerCase().endsWith('.csv')
    || (detected ? CSV_MIMES.has(detected.mime) : CSV_MIMES.has(filePart.type ?? ''))
  if (!isCsv) {
    throw createError({ statusCode: 415, statusMessage: 'Unsupported file. Upload a .csv file.' })
  }

  const { columns, rows } = parseCsv(filePart.data.toString('utf8'))
  if (columns.length === 0 || rows.length === 0) {
    throw createError({ statusCode: 422, statusMessage: 'The file has no readable rows.' })
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw createError({
      statusCode: 422,
      statusMessage: `Too many rows (${rows.length}). Max ${MAX_IMPORT_ROWS} per import.`,
    })
  }

  const [job] = await db.insert(importJob).values({
    organizationId: orgId,
    createdBy: session.user.id,
    source: 'csv',
    status: 'processing',
    filename: filePart.filename,
    columns,
    targetJobId,
  }).returning()

  if (!job) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to create import job' })
  }

  const mapping = autoMapColumns(columns)
  await stageRows({ orgId, jobId: job.id, rows, mapping })

  const [staged] = await db.select().from(importJob).where(eq(importJob.id, job.id))
  const preview = await buildPreview(staged!)

  trackEvent(event, session, 'candidate import created', {
    import_job_id: job.id,
    source: 'csv',
    total_rows: preview.summary.total,
    ready_rows: preview.summary.ready,
    duplicate_rows: preview.summary.duplicate,
  })
  logApiRequest(event, session, 'candidate_import.created', {
    import_job_id: job.id,
    total_rows: preview.summary.total,
  })

  setResponseStatus(event, 201)
  return preview
})
