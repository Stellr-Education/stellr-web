import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorE2eEvent, unmirrorE2eEvent } from './mirror-event'

function fakeDb(insertError: { code: string; message: string } | null = null) {
  const calls: { op: string; row?: Record<string, unknown>; filters: [string, unknown][] }[] = []
  const db = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        calls.push({ op: 'insert', row, filters: [] })
        return { error: insertError }
      },
      delete: () => {
        const call = { op: 'delete', filters: [] as [string, unknown][] }
        calls.push(call)
        const chain = { eq: (k: string, v: unknown) => (call.filters.push([k, v]), chain), then: (ok: (v: unknown) => unknown) => ok({ error: null }) }
        return chain
      },
    }),
  } as unknown as SupabaseClient
  return { db, calls }
}

describe('the e2e events-mirror row (S5 wave 8, ENF prep)', () => {
  it("mirrors an e2e event as Stellr's, with a sanity_id only this helper writes", async () => {
    const { db, calls } = fakeDb()
    await mirrorE2eEvent(db, 'e2e-checkin-ab12cd34', 'E2E Check-in ab12cd34')
    expect(calls[0].row).toMatchObject({ tenant_id: '00000000-0000-4000-8000-000000000001', slug: 'e2e-checkin-ab12cd34', sanity_id: 'e2e-mirror.e2e-checkin-ab12cd34' })
  })

  it('refuses a slug that is not an e2e one, and tolerates a repeat', async () => {
    await expect(mirrorE2eEvent(fakeDb().db, 'nevada-sdc', 'x')).rejects.toThrow(/non-e2e/)
    await expect(mirrorE2eEvent(fakeDb({ code: '23505', message: 'dup' }).db, 'e2e-survey-00000000', 'x')).resolves.toBeUndefined()
    await expect(mirrorE2eEvent(fakeDb({ code: '42501', message: 'denied' }).db, 'e2e-survey-00000000', 'x')).rejects.toThrow(/denied/)
  })

  it('removes only the row it wrote, and never a non-e2e slug', async () => {
    const { db, calls } = fakeDb()
    await unmirrorE2eEvent(db, 'e2e-artwork-0000ffff')
    expect(calls[0].filters).toEqual([['slug', 'e2e-artwork-0000ffff'], ['sanity_id', 'e2e-mirror.e2e-artwork-0000ffff']])
    const none = fakeDb()
    await unmirrorE2eEvent(none.db, 'nevada-sdc')
    expect(none.calls).toEqual([])
  })
})
