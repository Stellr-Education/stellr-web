import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CONSENT_PENDING_CODE,
  consentPendingParticipants,
  isConsentPending,
  isConsentPendingRefusal,
} from './check-in-consent'

type Row = { participant_id: string; registration_id: string; status: string }

/** Just enough of a client: one table, `.in()` and `.neq()`, recording what was asked. */
function fakeDb(rows: Row[], fail: 'error' | 'throw' | null = null) {
  const asked: { table: string; column: string; ids: string[]; neq: [string, string] }[] = []
  const db = {
    from: (table: string) => ({
      select: () => ({
        in: (column: keyof Row, ids: string[]) => ({
          neq: async (col: keyof Row, value: string) => {
            asked.push({ table, column, ids, neq: [col, value] })
            if (fail === 'throw') throw new Error('network')
            if (fail === 'error') return { data: null, error: { message: 'boom' } }
            return { data: rows.filter((r) => ids.includes(r[column]) && r[col] !== value).map((r) => ({ participant_id: r.participant_id })), error: null }
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
]

describe('consentPendingParticipants', () => {
  it('by participant: every unsigned state counts, as the trigger counts it; signed and no row do not', async () => {
    const { db, asked } = fakeDb(ROWS)
    const got = await consentPendingParticipants(db, { participantIds: ['p-pending', 'p-signed', 'p-declined', 'p-expired', 'p-stellr'] })
    expect([...got!].sort()).toEqual(['p-declined', 'p-expired', 'p-pending'])
    expect(asked).toEqual([
      { table: 'tenant_guardian_consents', column: 'participant_id', ids: ['p-pending', 'p-signed', 'p-declined', 'p-expired', 'p-stellr'], neq: ['status', 'signed'] },
    ])
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
