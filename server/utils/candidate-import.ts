/**
 * Bulk Candidate Import — normalization core
 * ─────────────────────────────────────────────
 *
 * Pure, deterministic helpers shared by the import API routes. They take raw
 * tabular records (keyed by the source file's own column names) and turn them
 * into the normalized candidate shape we can commit, plus the metadata the
 * preview step needs (dedupe key, validation status).
 *
 * Everything here is side-effect free and DB-free so it can be unit tested and
 * re-run against `importRow.rawData` without re-uploading. Duplicate detection
 * against *existing* candidates happens in the API layer where the DB lives;
 * this module only reports per-row validity and the dedupe hash.
 */
import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import type { PropertyType } from './schemas/property'

/** Hard ceiling on rows per import — guards memory and runaway commits. */
export const MAX_IMPORT_ROWS = 50_000

/**
 * Candidate fields an import column can map onto. `fullName` is a virtual
 * target: when present (and first/last aren't) it's split into first + last.
 */
export const IMPORT_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'displayName',
  'email',
  'phone',
  'gender',
  'dateOfBirth',
  'quickNotes',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

export const IMPORTABLE_PROPERTY_TYPES = [
  'text',
  'long_text',
  'number',
  'select',
  'multi_select',
  'date',
  'checkbox',
  'url',
  'email',
] as const satisfies readonly PropertyType[]

export type ImportablePropertyType = (typeof IMPORTABLE_PROPERTY_TYPES)[number]

/**
 * Prefix marking a mapping value as a *candidate property* target rather than a
 * native field — the suffix is the property definition's id (`prop:9f3c…`).
 * "New property" choices in the UI are resolved to a real definition id (and so
 * to this encoding) by the mapping route before anything is staged, so the rest
 * of the pipeline only ever sees native fields or existing property references.
 */
export const PROPERTY_TARGET_PREFIX = 'prop:'

/** True when a mapping value points at a candidate property, not a native field. */
export function isPropertyTarget(value: string): boolean {
  return value.startsWith(PROPERTY_TARGET_PREFIX)
}

/** Extract the property definition id from a `prop:<id>` mapping value. */
export function propertyIdFromTarget(value: string): string {
  return value.slice(PROPERTY_TARGET_PREFIX.length)
}

/**
 * Source-column → target mapping. A target is either a native candidate field
 * (an `ImportField`) or a `prop:<definitionId>` custom-property reference.
 */
export type ColumnMapping = Record<string, string>

/** The committable candidate shape produced from a valid row. */
export interface NormalizedCandidate {
  firstName: string
  lastName: string
  displayName: string | null
  email: string
  phone: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  dateOfBirth: string | null
  quickNotes: string | null
}

/**
 * A candidate property a column maps onto, resolved to a live definition. The
 * DB-touching service layer builds these (it knows each definition's type +
 * config); the pure normalizer just coerces `raw[column]` to the storage shape.
 */
export interface PropertyTarget {
  column: string
  definitionId: string
  type: ImportablePropertyType
  config: Record<string, unknown> | null
}

/** A storage-ready property value produced from a row, keyed by definition. */
export interface NormalizedPropertyValue {
  definitionId: string
  value: unknown
}

export interface NormalizedRow {
  /** Committable candidate, or null when the row failed validation. */
  data: NormalizedCandidate | null
  /** Property values coerced from mapped columns (empty on error rows). */
  properties: NormalizedPropertyValue[]
  /** Lowercased email if one was resolved — the dedupe anchor. */
  email: string | null
  status: 'ready' | 'error'
  errorMessage: string | null
}

// ── Header → field synonyms ────────────────────────────────────────
// Keys are canonicalized headers (lowercased, alphanumerics only) so
// "E-mail Address", "email_address" and "EmailAddress" all collapse together.
const FIELD_SYNONYMS: Record<string, ImportField> = {
  // email
  email: 'email', emailaddress: 'email', mail: 'email', candidateemail: 'email',
  workemail: 'email', personalemail: 'email', contactemail: 'email',
  // first name
  firstname: 'firstName', first: 'firstName', givenname: 'firstName',
  forename: 'firstName', fname: 'firstName', firstnames: 'firstName',
  // last name
  lastname: 'lastName', last: 'lastName', surname: 'lastName',
  familyname: 'lastName', lname: 'lastName',
  // full name
  name: 'fullName', fullname: 'fullName', candidatename: 'fullName',
  candidate: 'fullName', applicant: 'fullName', applicantname: 'fullName',
  contactname: 'fullName',
  // display / preferred name
  displayname: 'displayName', preferredname: 'displayName', nickname: 'displayName',
  knownas: 'displayName',
  // phone
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', mobilephone: 'phone',
  cell: 'phone', cellphone: 'phone', tel: 'phone', telephone: 'phone',
  contactnumber: 'phone',
  // gender
  gender: 'gender', sex: 'gender',
  // date of birth
  dateofbirth: 'dateOfBirth', dob: 'dateOfBirth', birthdate: 'dateOfBirth',
  birthday: 'dateOfBirth', dateofbirthday: 'dateOfBirth',
  // notes
  notes: 'quickNotes', note: 'quickNotes', comment: 'quickNotes',
  comments: 'quickNotes', remarks: 'quickNotes', summary: 'quickNotes',
}

/** Canonicalize a header for synonym lookup: lowercase, alphanumerics only. */
function canon(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Best-effort auto-mapping from source columns to candidate fields. First
 * column to claim a field wins, so leading columns take precedence over later
 * duplicates. The user confirms/overrides this in the preview step.
 */
export function autoMapColumns(columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const claimed = new Set<ImportField>()
  for (const col of columns) {
    const field = FIELD_SYNONYMS[canon(col)]
    if (field && !claimed.has(field)) {
      mapping[col] = field
      claimed.add(field)
    }
  }
  return mapping
}

// ── Value normalizers ──────────────────────────────────────────────
// Basic shape check — deliberately permissive. We reject obvious non-emails
// (no `@`, spaces, no dot in domain) rather than enforce full RFC compliance.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeGender(raw: string): NormalizedCandidate['gender'] {
  switch (canon(raw)) {
    case 'male': case 'm': case 'man': return 'male'
    case 'female': case 'f': case 'woman': return 'female'
    case 'other': case 'nonbinary': case 'nb': case 'x': return 'other'
    case 'prefernottosay': case 'na': case 'undisclosed': return 'prefer_not_to_say'
    default: return null
  }
}

/**
 * Conservative date parsing shared by DOB and date-property coercion. Accepts
 * ISO `YYYY-MM-DD`/`YYYY/MM/DD` directly; otherwise falls back to `Date` only
 * when the string carries an unambiguous 4-digit year. Returns the parsed
 * `Date` + its `YYYY-MM-DD` form, or null when nothing usable is found.
 */
function parseDateParts(raw: string): { date: Date; iso: string } | null {
  const trimmed = raw.trim()
  const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  let date: Date | null = null
  if (iso) {
    date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  }
  else if (/\b\d{4}\b/.test(trimmed)) {
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) date = parsed
  }
  if (!date || Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  if (iso && (
    date.getFullYear() !== Number(iso[1])
    || date.getMonth() + 1 !== Number(iso[2])
    || date.getDate() !== Number(iso[3])
  )) return null
  return { date, iso: `${year}-${mm}-${dd}` }
}

/**
 * Date-of-birth parsing. Returns `YYYY-MM-DD` or null — a bad optional DOB never
 * fails the whole row. Adds birthday-specific bounds (no future / pre-1900).
 */
function normalizeDob(raw: string): string | null {
  const parts = parseDateParts(raw)
  if (!parts) return null
  if (parts.date.getFullYear() < 1900 || parts.date > new Date()) return null
  return parts.iso
}

/**
 * Deterministic idempotency key for a row: org + normalized email. Two rows
 * (or two runs) with the same email produce the same hash, which is what makes
 * commit safely retryable and powers duplicate detection.
 */
export function computeDedupeHash(organizationId: string, email: string): string {
  return createHash('sha256')
    .update(`${organizationId}:${email.toLowerCase().trim()}`)
    .digest('hex')
}

/** Collapse raw record into a field-keyed object using the mapping. */
function applyMapping(raw: Record<string, string>, mapping: ColumnMapping): Partial<Record<ImportField, string>> {
  const out: Partial<Record<ImportField, string>> = {}
  for (const [col, field] of Object.entries(mapping)) {
    if (isPropertyTarget(field) || !IMPORT_FIELDS.includes(field as ImportField)) continue
    const value = raw[col]
    if (value != null && String(value).trim() !== '') {
      out[field as ImportField] = String(value).trim()
    }
  }
  return out
}

function selectOptions(config: Record<string, unknown> | null): { id: string; label: string }[] {
  const options = config?.options
  if (!Array.isArray(options)) return []
  return options.filter((option): option is { id: string; label: string } => (
    typeof option === 'object'
    && option !== null
    && typeof (option as { id?: unknown }).id === 'string'
    && typeof (option as { label?: unknown }).label === 'string'
  ))
}

function optionIdForValue(raw: string, config: Record<string, unknown> | null): string | null {
  const value = raw.trim()
  const lower = value.toLowerCase()
  const option = selectOptions(config).find((candidate) => (
    candidate.id === value || candidate.label.toLowerCase() === lower
  ))
  return option?.id ?? null
}

function normalizePropertyValue(raw: string, target: PropertyTarget): unknown {
  const value = raw.trim()
  switch (target.type) {
    case 'text': return value.length <= 500 ? value : undefined
    case 'long_text': return value.length <= 10_000 ? value : undefined
    case 'number': {
      const number = Number(value.replace(/\s/g, '').replace(',', '.'))
      return Number.isFinite(number) ? number : undefined
    }
    case 'date': return parseDateParts(value)?.iso
    case 'checkbox': {
      const normalized = canon(value)
      if (['true', 'yes', 'y', '1', 'checked'].includes(normalized)) return true
      if (['false', 'no', 'n', '0', 'unchecked'].includes(normalized)) return false
      return undefined
    }
    case 'url': {
      try {
        const parsed = new URL(value)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined
      }
      catch {
        return undefined
      }
    }
    case 'email': return EMAIL_RE.test(value) ? value.toLowerCase() : undefined
    case 'select': return optionIdForValue(value, target.config) ?? undefined
    case 'multi_select': {
      const ids = value
        .split(/[,;|]/)
        .map(part => optionIdForValue(part, target.config))
      if (ids.some(id => id === null)) return undefined
      return [...new Set(ids as string[])]
    }
  }
}

function normalizeProperties(
  raw: Record<string, string>,
  targets: PropertyTarget[],
): { values: NormalizedPropertyValue[]; errorMessage: string | null } {
  const values: NormalizedPropertyValue[] = []
  for (const target of targets) {
    const rawValue = raw[target.column]
    if (rawValue == null || String(rawValue).trim() === '') continue
    const value = normalizePropertyValue(String(rawValue), target)
    if (value === undefined) {
      return { values: [], errorMessage: `Invalid ${target.type} value in ${target.column}` }
    }
    values.push({ definitionId: target.definitionId, value })
  }
  return { values, errorMessage: null }
}

/** Infer a conservative default type from non-empty sample values. */
export function inferPropertyType(values: string[]): ImportablePropertyType {
  const samples = values.map(value => value.trim()).filter(Boolean)
  if (samples.length === 0) return 'text'
  if (samples.every(value => Number.isFinite(Number(value.replace(/\s/g, '').replace(',', '.'))))) return 'number'
  if (samples.every(value => EMAIL_RE.test(value))) return 'email'
  if (samples.every(value => parseDateParts(value) !== null)) return 'date'
  return 'text'
}

/**
 * Normalize a single raw record into a committable candidate. A row is `error`
 * (and excluded from commit) only when a *required* field — a valid email and
 * a resolvable first name — is missing; every other field is best-effort.
 */
export function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  propertyTargets: PropertyTarget[] = [],
): NormalizedRow {
  const fields = applyMapping(raw, mapping)

  // ── Email (required) ──
  const email = fields.email?.toLowerCase().trim() ?? null
  if (!email) {
    return { data: null, properties: [], email: null, status: 'error', errorMessage: 'Missing email' }
  }
  if (!EMAIL_RE.test(email)) {
    return { data: null, properties: [], email: null, status: 'error', errorMessage: `Invalid email: ${email}` }
  }

  // ── Name (required — derive from first/last or split a full name) ──
  let firstName = fields.firstName ?? ''
  let lastName = fields.lastName ?? ''
  if (!firstName && fields.fullName) {
    const parts = fields.fullName.split(/\s+/).filter(Boolean)
    firstName = parts.shift() ?? ''
    if (!lastName) lastName = parts.join(' ')
  }
  if (!firstName) {
    return { data: null, properties: [], email, status: 'error', errorMessage: 'Missing name' }
  }

  const properties = normalizeProperties(raw, propertyTargets)
  if (properties.errorMessage) {
    return { data: null, properties: [], email, status: 'error', errorMessage: properties.errorMessage }
  }

  const data: NormalizedCandidate = {
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    displayName: fields.displayName?.slice(0, 200) ?? null,
    email: email.slice(0, 255),
    phone: fields.phone?.slice(0, 50) ?? null,
    gender: fields.gender ? normalizeGender(fields.gender) : null,
    dateOfBirth: fields.dateOfBirth ? normalizeDob(fields.dateOfBirth) : null,
    quickNotes: fields.quickNotes?.slice(0, 1000) ?? null,
  }

  return { data, properties: properties.values, email, status: 'ready', errorMessage: null }
}

export interface ParsedCsv {
  columns: string[]
  rows: Record<string, string>[]
}

/**
 * Parse CSV text into headers + records via papaparse. Empty lines are dropped
 * ("greedy"), headers are trimmed, and every value is coerced to a string so
 * downstream normalization has a uniform shape to work with.
 */
export function parseCsv(content: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })
  const columns = (result.meta.fields ?? []).filter((c) => c !== '')
  const rows = result.data.map((row) => {
    const clean: Record<string, string> = {}
    for (const col of columns) clean[col] = row[col] == null ? '' : String(row[col])
    return clean
  })
  return { columns, rows }
}
