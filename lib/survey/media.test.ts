import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isNyCo, loadMediaAgreements, mediaPermission, mediaReasonDetail, type MediaFacts } from './media'

const signed = { exists: true, restricted: false, optOut: false, optOutKnown: true }
const facts = (over: Partial<MediaFacts> = {}): MediaFacts => ({
  isMinor: true,
  age: 15,
  states: ['NE'],
  agreement: signed,
  studentAllowMedia: null,
  ...over,
})

describe('media permission resolver', () => {
  it('a minor whose form was read with the box unticked is yes, and says so', () => {
    expect(mediaPermission(facts())).toEqual({ status: 'yes', reason: 'agreement_no_opt_out' })
  })

  it('a guardian opt-out on the agreement wins over the student turning media on', () => {
    expect(mediaPermission(facts({ agreement: { ...signed, optOut: true }, studentAllowMedia: true }))).toEqual({ status: 'no', reason: 'opted_out_on_agreement' })
  })

  it('a withdrawn consent is always no', () => {
    expect(mediaPermission(facts({ agreement: { ...signed, restricted: true }, studentAllowMedia: true })).reason).toBe('consent_withdrawn')
  })

  it('the student switch turned off is no, even with a clean form', () => {
    expect(mediaPermission(facts({ studentAllowMedia: false }))).toEqual({ status: 'no', reason: 'student_off' })
    expect(mediaPermission(facts({ isMinor: false, age: 20, agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false }, studentAllowMedia: false })).reason).toBe('student_off')
  })

  it('NY/CO 13–17 are off by default and on once they opt in', () => {
    expect(mediaPermission(facts({ states: ['New York'] }))).toEqual({ status: 'no', reason: 'ny_co_default' })
    expect(mediaPermission(facts({ states: ['NE', 'CO'] })).reason).toBe('ny_co_default')
    expect(mediaPermission(facts({ states: ['CO'], studentAllowMedia: true }))).toEqual({ status: 'yes', reason: 'opted_in' })
  })

  it('the NY/CO default is 13–17 only, and covers a minor of unknown age', () => {
    expect(mediaPermission(facts({ states: ['CO'], age: 12 })).status).toBe('yes')
    expect(mediaPermission(facts({ states: ['CO'], age: 18, isMinor: false })).status).toBe('yes')
    expect(mediaPermission(facts({ states: ['CO'], age: null })).reason).toBe('ny_co_default')
  })

  it('a minor with no signed agreement is no; one whose form cannot be read is check', () => {
    expect(mediaPermission(facts({ agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false } }))).toEqual({ status: 'no', reason: 'no_agreement' })
    expect(mediaPermission(facts({ agreement: { ...signed, optOutKnown: false } }))).toEqual({ status: 'check', reason: 'form_unread' })
  })

  it('a ticked box is honoured even when the rest of the form is unreadable', () => {
    expect(mediaPermission(facts({ agreement: { exists: true, restricted: false, optOut: true, optOutKnown: false } })).status).toBe('no')
  })

  it('adults need no minor agreement', () => {
    expect(mediaPermission(facts({ isMinor: false, age: 34, states: ['CO'], agreement: { exists: false, restricted: false, optOut: false, optOutKnown: false } }))).toEqual({ status: 'yes', reason: 'default' })
  })

  it('an ADULT whose signed form could not be read is check, not yes (DS-6)', () => {
    // deep review DS-6: an educator/mentor/volunteer whose media opt-out could
    // not be read back must fail closed to "check", exactly as a minor does — a
    // failed read must never default to "yes, may use photos".
    expect(mediaPermission(facts({
      isMinor: false, age: 35, states: [], studentAllowMedia: null,
      agreement: { exists: true, restricted: false, optOut: false, optOutKnown: false },
    }))).toEqual({ status: 'check', reason: 'form_unread' })
  })

  it('says who answered and on which form', () => {
    const minor = { isMinor: true, signedAt: '2026-10-02T15:04:00Z' }
    expect(mediaReasonDetail({ ...minor, decision: { status: 'no', reason: 'opted_out_on_agreement' } }))
      .toBe('Parent/guardian ticked “I do NOT consent” to photo and media use on the agreement signed Oct 2, 2026')
    expect(mediaReasonDetail({ ...minor, decision: { status: 'yes', reason: 'agreement_no_opt_out' } }))
      .toBe('Parent/guardian left “I do NOT consent” to photo and media use unticked on the agreement signed Oct 2, 2026')
    expect(mediaReasonDetail({ isMinor: false, signedAt: null, decision: { status: 'no', reason: 'opted_out_on_agreement' } }))
      .toBe('Ticked “I do NOT consent” to photo and media use on the signed agreement')
    expect(mediaReasonDetail({ ...minor, decision: { status: 'check', reason: 'form_unread' } }))
      .toBe('Photo and media answer not read from the agreement signed Oct 2, 2026 yet: open it under Consent forms')
  })

  it('reads state names and codes', () => {
    expect(isNyCo(['Colorado'])).toBe(true)
    expect(isNyCo(['ny'])).toBe(true)
    expect(isNyCo([null, 'Nebraska'])).toBe(false)
  })
})

// S5 wave 8, A11b: a member's newest form counts only when it is this tenant's.
describe('loadMediaAgreements across tenants', () => {
  const CANARY = '00000000-0000-4000-8000-0000000ca4a2'
  function fakeDb(rows: Record<string, unknown>[]): SupabaseClient {
    const result = (table: string, cols: string) => ({
      data: table === 'agreements' && cols.includes('template_id') ? rows : [],
      error: null,
    })
    return {
      from: (table: string) => ({
        select: (cols: string) => {
          const chain = {
            in: () => chain,
            eq: () => chain,
            then: (ok: (v: unknown) => unknown) => Promise.resolve(result(table, cols)).then(ok),
          }
          return chain
        },
      }),
    } as unknown as SupabaseClient
  }
  const subject = { key: 'member:m1', memberId: 'm1', participantId: null }
  const row = (id: string, tenant: string | null, at: string) => ({
    id, member_id: 'm1', participant_id: null, completed_at: at, reused_from: null, restricted_at: null, template_id: null, tenant_id: tenant,
  })

  it('leaves out a newer form signed for another tenant and uses the Stellr one', async () => {
    const out = await loadMediaAgreements(fakeDb([row('a-stellr', null, '2026-01-01'), row('a-canary', CANARY, '2026-06-01')]), [subject])
    expect(out.get('member:m1')?.signedAt).toBe('2026-01-01')
  })

  it('finds nothing when the only form is another tenant\'s', async () => {
    const out = await loadMediaAgreements(fakeDb([row('a-canary', CANARY, '2026-06-01')]), [subject])
    expect(out.get('member:m1')?.exists ?? false).toBe(false)
  })
})
