// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fields = typeof import('@/lib/field-crypto-fields')
let SENSITIVE_TABLES: Fields['SENSITIVE_TABLES']
let sensitiveTable: Fields['sensitiveTable']
let encColumn: Fields['encColumn']
let bidxColumn: Fields['bidxColumn']
let shadowColumns: Fields['shadowColumns']
let plaintextKeys: Fields['plaintextKeys']

// The catalogue is module-level data, so the module is loaded afresh inside
// each test rather than once at import: a mutation run (stryker.config.mjs)
// switches its mutants on after a test file's static imports have run, and
// only a load inside the test sees a mutated catalogue.
beforeEach(async () => {
  vi.resetModules()
  ;({ SENSITIVE_TABLES, sensitiveTable, encColumn, bidxColumn, shadowColumns, plaintextKeys } = await import(
    '@/lib/field-crypto-fields'
  ))
})

// The catalogue decides which columns are encrypted, how each row's tenant is
// found (so which data key encrypts it), which row id is bound into the AAD,
// and which columns get an equality blind index. Each of those is a security
// decision: pin them explicitly so a change has to be made here on purpose.

describe('sensitive-column catalogue: pinned decisions', () => {
  it('lists exactly three tables, with their AAD id column and tenant source', () => {
    expect(SENSITIVE_TABLES.map((t) => [t.table, t.idColumn, t.tenantFrom])).toEqual([
      ['participants', 'id', 'registration'],
      ['members', 'id', 'platform'],
      ['member_pending_consent', 'member_id', 'platform'],
    ])
  })

  it('participants: every column, its kind, category and blind index', () => {
    expect(sensitiveTable('participants').fields).toEqual([
      { column: 'health_conditions', kind: 'text', category: 'health' },
      { column: 'dietary_requirements', kind: 'text_array', category: 'dietary' },
      { column: 'emergency_contact_first_name', kind: 'text', category: 'emergency_contact' },
      { column: 'emergency_contact_last_name', kind: 'text', category: 'emergency_contact' },
      { column: 'emergency_contact_email', kind: 'text', blindIndex: 'email', category: 'emergency_contact' },
      { column: 'emergency_contact_phone', kind: 'text', blindIndex: 'phone', category: 'emergency_contact' },
      { column: 'emergency_contact_relationship', kind: 'text', category: 'emergency_contact' },
    ])
  })

  it('members: every column, its kind, category and blind index', () => {
    expect(sensitiveTable('members').fields).toEqual([
      { column: 'health_conditions', kind: 'text', category: 'health' },
      { column: 'ec_first_name', kind: 'text', category: 'emergency_contact' },
      { column: 'ec_last_name', kind: 'text', category: 'emergency_contact' },
      { column: 'ec_email', kind: 'text', blindIndex: 'email', category: 'emergency_contact' },
      { column: 'ec_phone', kind: 'text', blindIndex: 'phone', category: 'emergency_contact' },
      { column: 'ec_relationship', kind: 'text', category: 'emergency_contact' },
    ])
  })

  it('member_pending_consent: guardian name and email, the email blind-indexed', () => {
    expect(sensitiveTable('member_pending_consent').fields).toEqual([
      { column: 'guardian_name', kind: 'text', category: 'guardian_contact' },
      { column: 'guardian_email', kind: 'text', blindIndex: 'email', category: 'guardian_contact' },
    ])
  })

  it('sensitiveTable returns the named entry and refuses an unknown table', () => {
    expect(sensitiveTable('members')).toBe(SENSITIVE_TABLES[1])
    expect(() => sensitiveTable('registrations' as never)).toThrow('Not a sensitive table: registrations')
  })
})

describe('shadow column names', () => {
  it('encColumn and bidxColumn add the suffixes', () => {
    expect(encColumn('ec_email')).toBe('ec_email_enc')
    expect(bidxColumn('ec_email')).toBe('ec_email_bidx')
  })

  it('shadowColumns gives _enc for every field and _bidx only where blind-indexed, in order', () => {
    expect(shadowColumns(sensitiveTable('member_pending_consent'))).toEqual([
      'guardian_name_enc',
      'guardian_email_enc',
      'guardian_email_bidx',
    ])
    expect(shadowColumns(sensitiveTable('members'))).toEqual([
      'health_conditions_enc',
      'ec_first_name_enc',
      'ec_last_name_enc',
      'ec_email_enc',
      'ec_email_bidx',
      'ec_phone_enc',
      'ec_phone_bidx',
      'ec_relationship_enc',
    ])
  })

  it('plaintextKeys is the sorted, de-duplicated union of every column', () => {
    expect(plaintextKeys()).toEqual([
      'dietary_requirements',
      'ec_email',
      'ec_first_name',
      'ec_last_name',
      'ec_phone',
      'ec_relationship',
      'emergency_contact_email',
      'emergency_contact_first_name',
      'emergency_contact_last_name',
      'emergency_contact_phone',
      'emergency_contact_relationship',
      'guardian_email',
      'guardian_name',
      'health_conditions',
    ])
  })
})
