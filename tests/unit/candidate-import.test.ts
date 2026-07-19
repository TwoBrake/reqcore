import { describe, it, expect } from 'vitest'
import {
  autoMapColumns,
  normalizeRow,
  computeDedupeHash,
  inferPropertyType,
  parseCsv,
  type ColumnMapping,
} from '../../server/utils/candidate-import'
import { setMappingSchema } from '../../server/utils/schemas/import'

describe('autoMapColumns', () => {
  it('maps common header variants to candidate fields', () => {
    const mapping = autoMapColumns(['First Name', 'Last Name', 'E-mail Address', 'Mobile Phone'])
    expect(mapping).toEqual({
      'First Name': 'firstName',
      'Last Name': 'lastName',
      'E-mail Address': 'email',
      'Mobile Phone': 'phone',
    })
  })

  it('maps a single Name column to the virtual fullName field', () => {
    expect(autoMapColumns(['Name', 'Email'])).toEqual({ Name: 'fullName', Email: 'email' })
  })

  it('lets the first column claim a field and ignores later duplicates', () => {
    const mapping = autoMapColumns(['email', 'work_email'])
    expect(mapping).toEqual({ email: 'email' })
  })

  it('ignores unrecognized columns', () => {
    expect(autoMapColumns(['Random', 'Unknown Column'])).toEqual({})
  })
})

describe('normalizeRow', () => {
  const mapping: ColumnMapping = {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    Email: 'email',
    Phone: 'phone',
    Gender: 'gender',
    DOB: 'dateOfBirth',
  }

  it('normalizes a complete valid row', () => {
    const row = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Lovelace', Email: '  Ada@Example.com ', Phone: '555-1234', Gender: 'F', DOB: '1990-03-15' },
      mapping,
    )
    expect(row.status).toBe('ready')
    expect(row.data).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '555-1234',
      gender: 'female',
      dateOfBirth: '1990-03-15',
    })
  })

  it('splits a full name when first/last are absent', () => {
    const row = normalizeRow({ Name: 'Grace Brewster Hopper', Email: 'grace@navy.mil' }, { Name: 'fullName', Email: 'email' })
    expect(row.data?.firstName).toBe('Grace')
    expect(row.data?.lastName).toBe('Brewster Hopper')
  })

  it('accepts a single-token name (empty last name)', () => {
    const row = normalizeRow({ Name: 'Prince', Email: 'prince@paisley.park' }, { Name: 'fullName', Email: 'email' })
    expect(row.status).toBe('ready')
    expect(row.data).toMatchObject({ firstName: 'Prince', lastName: '' })
  })

  it('errors when email is missing', () => {
    const row = normalizeRow({ 'First Name': 'Ada', 'Last Name': 'Lovelace' }, mapping)
    expect(row.status).toBe('error')
    expect(row.errorMessage).toMatch(/missing email/i)
  })

  it('errors on a malformed email', () => {
    const row = normalizeRow({ 'First Name': 'Ada', 'Last Name': 'Lovelace', Email: 'not-an-email' }, mapping)
    expect(row.status).toBe('error')
    expect(row.errorMessage).toMatch(/invalid email/i)
  })

  it('errors when no name can be resolved', () => {
    const row = normalizeRow({ Email: 'ghost@example.com' }, { Email: 'email' })
    expect(row.status).toBe('error')
    expect(row.errorMessage).toMatch(/missing name/i)
  })

  it('drops an unparseable optional DOB instead of failing the row', () => {
    const row = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Lovelace', Email: 'ada@example.com', DOB: 'sometime in the 90s' },
      mapping,
    )
    expect(row.status).toBe('ready')
    expect(row.data?.dateOfBirth).toBeNull()
  })

  it('normalizes MM/DD/YYYY-style dates to ISO', () => {
    const row = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Lovelace', Email: 'ada@example.com', DOB: '1990/03/15' },
      mapping,
    )
    expect(row.data?.dateOfBirth).toBe('1990-03-15')
  })

  it('rejects future / implausible birth years', () => {
    const row = normalizeRow(
      { 'First Name': 'Ada', 'Last Name': 'Lovelace', Email: 'ada@example.com', DOB: '2999-01-01' },
      mapping,
    )
    expect(row.data?.dateOfBirth).toBeNull()
  })

  it('normalizes mapped candidate property values without treating them as native fields', () => {
    const row = normalizeRow(
      {
        Name: 'Ada Lovelace',
        Email: 'ada@example.com',
        Experience: '12.5',
        Skills: 'TypeScript; SQL',
      },
      {
        Name: 'fullName',
        Email: 'email',
        Experience: 'prop:experience',
        Skills: 'prop:skills',
      },
      [
        { column: 'Experience', definitionId: 'experience', type: 'number', config: { format: 'plain' } },
        {
          column: 'Skills',
          definitionId: 'skills',
          type: 'multi_select',
          config: {
            options: [
              { id: 'ts', label: 'TypeScript', color: 'gray' },
              { id: 'sql', label: 'SQL', color: 'gray' },
            ],
          },
        },
      ],
    )

    expect(row.status).toBe('ready')
    expect(row.properties).toEqual([
      { definitionId: 'experience', value: 12.5 },
      { definitionId: 'skills', value: ['ts', 'sql'] },
    ])
  })

  it('marks a row invalid when a mapped property cannot be coerced', () => {
    const row = normalizeRow(
      { Name: 'Ada Lovelace', Email: 'ada@example.com', Experience: 'many' },
      { Name: 'fullName', Email: 'email', Experience: 'prop:experience' },
      [{ column: 'Experience', definitionId: 'experience', type: 'number', config: null }],
    )

    expect(row.status).toBe('error')
    expect(row.errorMessage).toBe('Invalid number value in Experience')
    expect(row.properties).toEqual([])
  })

  it('omits empty property cells rather than clearing existing values', () => {
    const row = normalizeRow(
      { Name: 'Ada Lovelace', Email: 'ada@example.com', Location: '   ' },
      { Name: 'fullName', Email: 'email', Location: 'prop:location' },
      [{ column: 'Location', definitionId: 'location', type: 'text', config: null }],
    )

    expect(row.status).toBe('ready')
    expect(row.properties).toEqual([])
  })
})

describe('inferPropertyType', () => {
  it('infers number, email, and date samples conservatively', () => {
    expect(inferPropertyType(['12', '3.5', '1 000'])).toBe('number')
    expect(inferPropertyType(['ada@example.com', 'grace@navy.mil'])).toBe('email')
    expect(inferPropertyType(['2025-01-10', '2024/12/31'])).toBe('date')
  })

  it('falls back to text for mixed or empty samples', () => {
    expect(inferPropertyType(['12', 'unknown'])).toBe('text')
    expect(inferPropertyType([])).toBe('text')
  })
})

describe('setMappingSchema', () => {
  it('accepts native, existing-property, and explicit new-property targets', () => {
    const result = setMappingSchema.parse({
      mapping: { Email: 'email', Location: 'prop:location-id' },
      newProperties: [{ column: 'Experience', name: 'Years of experience', type: 'number' }],
    })

    expect(result.newProperties).toHaveLength(1)
  })

  it('rejects mapping two columns to the same target', () => {
    expect(() => setMappingSchema.parse({
      mapping: { 'Work email': 'email', 'Personal email': 'email' },
    })).toThrow()
  })

  it('rejects unsupported property target encodings and file properties', () => {
    expect(() => setMappingSchema.parse({ mapping: { Location: 'location-id' } })).toThrow()
    expect(() => setMappingSchema.parse({
      mapping: { Email: 'email' },
      newProperties: [{ column: 'Resume', name: 'Resume', type: 'file' }],
    })).toThrow()
  })
})

describe('computeDedupeHash', () => {
  it('is stable across case and whitespace', () => {
    expect(computeDedupeHash('org1', ' Ada@Example.com ')).toBe(computeDedupeHash('org1', 'ada@example.com'))
  })

  it('differs across organizations', () => {
    expect(computeDedupeHash('org1', 'ada@example.com')).not.toBe(computeDedupeHash('org2', 'ada@example.com'))
  })
})

describe('parseCsv', () => {
  it('parses headers and rows, trimming header whitespace', () => {
    const { columns, rows } = parseCsv('First Name , Email\nAda,ada@example.com\nGrace,grace@navy.mil\n')
    expect(columns).toEqual(['First Name', 'Email'])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ 'First Name': 'Ada', Email: 'ada@example.com' })
  })

  it('handles quoted fields containing commas', () => {
    const { rows } = parseCsv('Name,Notes\n"Hopper, Grace","Rear Admiral, USN"\n')
    expect(rows[0]).toEqual({ Name: 'Hopper, Grace', Notes: 'Rear Admiral, USN' })
  })

  it('skips empty lines', () => {
    const { rows } = parseCsv('Name,Email\nAda,ada@example.com\n\n\n')
    expect(rows).toHaveLength(1)
  })
})
