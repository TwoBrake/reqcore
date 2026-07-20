import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { importJob, importRow, propertyDefinition } from '../../../../database/schema'
import {
  IMPORTABLE_PROPERTY_TYPES,
  isPropertyTarget,
  propertyIdFromTarget,
  type ImportablePropertyType,
} from '../../../../utils/candidate-import'
import { importIdParamSchema, setMappingSchema } from '../../../../utils/schemas/import'
import { stageRows, buildPreview } from '../../../../utils/candidate-import-service'

/**
 * PUT /api/candidates/import/:id/mapping
 *
 * Confirm or change the source-column → candidate-field mapping. Re-normalizes
 * and re-classifies every staged row from its preserved `rawData` (no re-upload
 * needed) and returns the refreshed preview. Only allowed before commit.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['create'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, importIdParamSchema.parse)
  const { mapping, newProperties } = await readValidatedBody(event, setMappingSchema.parse)

  const [job] = await db.select().from(importJob)
    .where(and(eq(importJob.id, id), eq(importJob.organizationId, orgId)))
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Import job not found' })
  }
  if (job.status !== 'previewing' && job.status !== 'processing') {
    throw createError({ statusCode: 409, statusMessage: `Cannot re-map a job that is ${job.status}.` })
  }

  // Creating schema is intentionally explicit and remains admin-only. Mapping
  // to an existing candidate property only requires the normal import permission.
  if (newProperties.length > 0) {
    await requirePermission(event, { organization: ['update'] })
  }

  // Rebuild the source rows from preserved rawData, in original order.
  const staged = await db.query.importRow.findMany({
    where: eq(importRow.jobId, job.id),
    orderBy: (r, { asc }) => [asc(r.rowIndex)],
    columns: { rawData: true },
  })
  const rows = staged.map((r) => r.rawData)

  const sourceColumns = new Set(job.columns ?? [])
  const requestedColumns = [...Object.keys(mapping), ...newProperties.map(property => property.column)]
  if (requestedColumns.some(column => !sourceColumns.has(column))) {
    throw createError({ statusCode: 422, statusMessage: 'Mapping contains a column not present in this import' })
  }

  const existingPropertyIds = [...new Set(
    Object.values(mapping).filter(isPropertyTarget).map(propertyIdFromTarget),
  )]
  if (existingPropertyIds.length > 0) {
    const definitions = await db.query.propertyDefinition.findMany({
      where: and(
        eq(propertyDefinition.organizationId, orgId),
        eq(propertyDefinition.entityType, 'candidate'),
        isNull(propertyDefinition.jobId),
        inArray(propertyDefinition.id, existingPropertyIds),
      ),
      columns: { id: true, type: true },
    })
    if (
      definitions.length !== existingPropertyIds.length
      || definitions.some(definition => !IMPORTABLE_PROPERTY_TYPES.includes(definition.type as ImportablePropertyType))
    ) {
      throw createError({ statusCode: 422, statusMessage: 'Mapping contains an invalid candidate property' })
    }
  }

  const resolvedMapping = { ...mapping }
  if (newProperties.length > 0) {
    const [last] = await db.select({ displayOrder: propertyDefinition.displayOrder })
      .from(propertyDefinition)
      .where(and(
        eq(propertyDefinition.organizationId, orgId),
        eq(propertyDefinition.entityType, 'candidate'),
        isNull(propertyDefinition.jobId),
      ))
      .orderBy(desc(propertyDefinition.displayOrder))
      .limit(1)

    const definitions = newProperties.map((property, index) => {
      let config: Record<string, unknown> | null = null
      if (property.type === 'select' || property.type === 'multi_select') {
        const byLabel = new Map<string, string>()
        for (const row of rows) {
          const raw = row[property.column]?.trim()
          if (!raw) continue
          const labels = property.type === 'multi_select' ? raw.split(/[,;|]/) : [raw]
          for (const value of labels) {
            const label = value.trim()
            if (label && !byLabel.has(label.toLowerCase())) byLabel.set(label.toLowerCase(), label)
          }
        }
        if (byLabel.size > 50) {
          throw createError({
            statusCode: 422,
            statusMessage: `${property.name} has more than 50 options; import it as text instead`,
          })
        }
        config = {
          options: [...byLabel.values()].map(label => ({ id: randomUUID(), label, color: 'gray' })),
        }
      }
      else if (property.type === 'number') {
        config = { format: 'plain' }
      }
      return {
        organizationId: orgId,
        entityType: 'candidate' as const,
        type: property.type,
        name: property.name,
        jobId: null,
        config,
        displayOrder: (last?.displayOrder ?? -1) + index + 1,
      }
    })
    const created = await db.insert(propertyDefinition).values(definitions).returning({ id: propertyDefinition.id })
    newProperties.forEach((property, index) => {
      resolvedMapping[property.column] = `prop:${created[index]!.id}`
      recordActivity({
        organizationId: orgId,
        actorId: session.user.id,
        action: 'created',
        resourceType: 'property',
        resourceId: created[index]!.id,
        metadata: { entityType: 'candidate', type: property.type, source: 'candidate_import' },
      })
    })
  }

  await stageRows({ orgId, jobId: job.id, rows, mapping: resolvedMapping })

  const [updated] = await db.select().from(importJob).where(eq(importJob.id, job.id))
  return buildPreview(updated!)
})
