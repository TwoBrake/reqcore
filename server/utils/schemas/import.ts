import { z } from 'zod'
import {
  IMPORTABLE_PROPERTY_TYPES,
  IMPORT_FIELDS,
  PROPERTY_TARGET_PREFIX,
} from '../candidate-import'

// ─────────────────────────────────────────────
// Bulk candidate import — request validation schemas
// ─────────────────────────────────────────────

/** `:id` route param for import job routes. */
export const importIdParamSchema = z.object({
  id: z.string().min(1),
})

/**
 * A confirmed source-column → candidate-field mapping. Keys are the file's own
 * column names; values must be one of the known candidate target fields.
 */
const mappingTargetSchema = z.union([
  z.enum(IMPORT_FIELDS),
  z.string().startsWith(PROPERTY_TARGET_PREFIX).min(PROPERTY_TARGET_PREFIX.length + 1),
])

export const setMappingSchema = z.object({
  mapping: z.record(z.string(), mappingTargetSchema),
  newProperties: z.array(z.object({
    column: z.string().min(1),
    name: z.string().trim().min(1, 'Property name is required').max(80),
    type: z.enum(IMPORTABLE_PROPERTY_TYPES),
  })).max(100).default([]),
}).superRefine((value, ctx) => {
  const columns = new Set<string>()
  const targets = new Set<string>()
  for (const [column, target] of Object.entries(value.mapping)) {
    if (targets.has(target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mapping', column],
        message: 'Each target can only be mapped once',
      })
    }
    targets.add(target)
  }
  for (const property of value.newProperties) {
    if (columns.has(property.column) || value.mapping[property.column]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newProperties'],
        message: `Column ${property.column} has more than one target`,
      })
    }
    columns.add(property.column)
  }
})

/**
 * Commit options. `duplicatePolicy` decides what happens to rows that match an
 * existing candidate: skip them, or overwrite the existing record's fields.
 * (The unique (org, email) constraint makes "create anyway" impossible, so it
 * is intentionally not offered.)
 */
export const commitImportSchema = z.object({
  duplicatePolicy: z.enum(['skip', 'update']).default('skip'),
})
