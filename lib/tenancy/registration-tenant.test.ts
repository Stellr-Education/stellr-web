import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRegistrationTenantId } from './registration-tenant'
import { STELLR_TENANT_ID } from './constants'

const CANARY = '00000000-0000-4000-8000-0000000ca4a2'
const db = (answer: { data: unknown; error: unknown } | 'throws') =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (answer === 'throws') throw new Error('network down')
            return answer
          },
        }),
      }),
    }),
  }) as unknown as SupabaseClient

describe('loadRegistrationTenantId (S5 wave 8, Lane C writers)', () => {
  it('answers the registration’s own tenant', async () => {
    expect(await loadRegistrationTenantId(db({ data: { tenant_id: CANARY }, error: null }), 'reg-1')).toBe(CANARY)
  })
  it('reads a NULL tenant_id as Stellr’s, as everywhere in S5', async () => {
    expect(await loadRegistrationTenantId(db({ data: { tenant_id: null }, error: null }), 'reg-1')).toBe(STELLR_TENANT_ID)
  })
  it('answers null, leaving the trigger to decide, for no id, no row, a read error or a throw', async () => {
    expect(await loadRegistrationTenantId(db({ data: null, error: null }), null)).toBeNull()
    expect(await loadRegistrationTenantId(db({ data: null, error: null }), 'reg-1')).toBeNull()
    expect(await loadRegistrationTenantId(db({ data: null, error: { message: 'down' } }), 'reg-1')).toBeNull()
    expect(await loadRegistrationTenantId(db('throws'), 'reg-1')).toBeNull()
  })
})
