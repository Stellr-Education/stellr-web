import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CONSENT_NOT_HELD,
  CONSENT_PENDING_CODE,
  consentPendingParticipants,
  isConsentPending,
  isConsentPendingRefusal,
} from './check-in-consent'

type Row = { participant_id: string; registration_id: string; status: string }

/** PostgREST's `in` list, `(a,b)`, as the values it names. */
const inList = (list: string) => list.replace(/^\(|\)$/g, '').split(',')

/** Just enough of a client: one table, `.in()` and `.not(col, 'in', list)`, recording what was asked. */
function fakeDb(rows: Row[], fail: 'error' | 'throw' | null = null) {
  const asked: { table: string; column: string; ids: string[]; not: [string, string, string] }[] = []
  const db = {
    from: (table: string) => ({
      select: () => ({
        in: (column: keyof Row, ids: string[]) => ({
          not: async (col: keyof Row, op: string, list: string) => {
            asked.push({ table, column, ids, not: [col, op, list] })
            if (fail === 'throw') throw new Error('network')
            if (fail === 'error') return { data: null, error: { message: 'boom' } }
            if (op !== 'in') throw new Error(`fake supports not.in only, got not.${op}`)
            const excluded = inList(list)
            return {
              data: rows.filter((r) => ids.includes(r[column]) && !excluded.includes(r[col])).map((r) => ({ participant_id: r.participant_id })),
              error: null,
            }
          },
        }),
      }),
    }),
  }
  return { db: db as unknown as SupabaseClient, asked }
}

const ROWS: Row[] = [
  { participant_id: 'p-pending', registration_id: 'r1', status: 'pending' },
  { participant_id: 'p-signed', registration_id: 'r1', status: 'signed' },
  { participant_id: 'p-declined', registration_id: 'r2', status: 'declined' },
  { participant_id: 'p-expired', registration_id: 'r2', status: 'expired' },
  { participant_id: 'p-settled', registration_id: 'r1', status: 'settled' },
]

describe('consentPendingParticipants', () => {
  it('by participant: every held state counts, as the trigger counts it; signed, settled and no row do not', async () => {
    const { db, asked } = fakeDb(ROWS)
    const ids = ['p-pending', 'p-signed', 'p-declined', 'p-expired', 'p-settled', 'p-stellr']
    const got = await consentPendingParticipants(db, { participantIds: ids })
    expect([...got!].sort()).toEqual(['p-declined', 'p-expired', 'p-pending'])
    expect(asked).toEqual([{ table: 'tenant_guardian_consents', column: 'participant_id', ids, not: ['status', 'in', '(signed,settled)'] }])
  })

  it('a settled consent (lifted by a date-of-birth correction to 18 or over) does not hold, as the trigger since 20261114072142', async () => {
    const { db } = fakeDb(ROWS)
    expect((await consentPendingParticipants(db, { participantIds: ['p-settled'] }))!.size).toBe(0)
  })

  it("the statuses that don't hold are exactly the trigger's NOT IN list", () => {
    expect([...CONSENT_NOT_HELD]).toEqual(['signed', 'settled'])
  })

  it('by registration: the desk poll', async () => {
    const { db, asked } = fakeDb(ROWS)
    expect([...(await consentPendingParticipants(db, { registrationIds: ['r1'] }))!]).toEqual(['p-pending'])
    expect(asked[0].column).toBe('registration_id')
  })

  it('a Stellr event has no consent rows: empty', async () => {
    const { db } = fakeDb([])
    expect((await consentPendingParticipants(db, { registrationIds: ['r-stellr'] }))!.size).toBe(0)
  })

  it('asks nothing for an empty list', async () => {
    const { db, asked } = fakeDb(ROWS)
    expect((await consentPendingParticipants(db, { participantIds: [] }))!.size).toBe(0)
    expect(asked).toEqual([])
  })

  it.each(['error', 'throw'] as const)('a failed read (%s) is null, never a throw', async (fail) => {
    const { db } = fakeDb(ROWS, fail)
    expect(await consentPendingParticipants(db, { participantIds: ['p-pending'] })).toBeNull()
  })
})

describe('isConsentPending', () => {
  it('is true only for a row the poll marked', () => {
    expect(isConsentPending({ id: 'a', consentPending: true })).toBe(true)
    expect(isConsentPending({ id: 'a' })).toBe(false)
    expect(isConsentPending({ id: 'a', consentPending: 'yes' })).toBe(false)
  })
})

describe('isConsentPendingRefusal', () => {
  it('knows the trigger’s refusal and nothing else', () => {
    expect(isConsentPendingRefusal({ code: '23514', message: CONSENT_PENDING_CODE })).toBe(true)
    expect(isConsentPendingRefusal({ code: '23514', message: 'participant eligibility: dob_missing' })).toBe(false)
    expect(isConsentPendingRefusal({ code: '42501', message: CONSENT_PENDING_CODE })).toBe(false)
    expect(isConsentPendingRefusal(null)).toBe(false)
  })
})
