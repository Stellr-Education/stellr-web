// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// The payment gate, the envelope-status merge, the report-only logger and the
// enforcement flag (access-gates.test.ts covers the minor/DocuSign rules).

let db: FakeDb
const logActivity = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))
vi.mock('@/lib/activity-log', () => ({ logActivity: (...args: unknown[]) => logActivity(...args) }))

type Mod = typeof import('./access-gates')
let accessGatesEnforced: Mod['accessGatesEnforced']
let eventAccessGates: Mod['eventAccessGates']
let reportEnrollmentGate: Mod['reportEnrollmentGate']
let reportEventAccessGates: Mod['reportEventAccessGates']

// The module is loaded afresh before each test: its module-level constants
// and tables are evaluated at load, and a mutation run (stryker.config.mjs)
// switches a mutant on only after a file's static imports have run.
beforeEach(async () => {
  vi.resetModules()
  ;({ accessGatesEnforced, eventAccessGates, reportEnrollmentGate, reportEventAccessGates } = await import('./access-gates'))
})
import type { CommunityMember } from './community'

const SLUG = 'nevada-2026'
const MEMBER_ID = 'member-1'
const member = { id: MEMBER_ID } as CommunityMember
const ADULT_DOB = `${new Date().getFullYear() - 40}-04-02`
const MINOR_DOB = `${new Date().getFullYear() - 14}-01-15`

type RegOver = Partial<{ event_slug: string; status: string; amount_due_cents: number | null; invoice_requested: boolean | null; invoice_paid_at: string | null }>
function part(reg: RegOver, over: Partial<{ id: string; individual_payment_status: string | null; date_of_birth: string | null; event_role: string | null }> = {}, asArray = false) {
  const registration = { event_slug: SLUG, status: 'pending', amount_due_cents: 0, invoice_requested: false, invoice_paid_at: null, ...reg }
  return {
    id: 'p-1',
    member_id: MEMBER_ID,
    date_of_birth: ADULT_DOB,
    event_role: 'participant',
    individual_payment_status: null,
    ...over,
    registrations: asArray ? [registration] : registration,
  }
}

beforeEach(() => {
  logActivity.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('accessGatesEnforced', () => {
  it('is on only for the exact string true', () => {
    vi.stubEnv('ACCESS_GATES_ENFORCE', 'true')
    expect(accessGatesEnforced()).toBe(true)
    for (const v of ['', 'TRUE', '1', 'false']) {
      vi.stubEnv('ACCESS_GATES_ENFORCE', v)
      expect(accessGatesEnforced(), v).toBe(false)
    }
  })
})

describe('eventAccessGates — payment', () => {
  it('a member with no participation in this event is ungated', async () => {
    db = fakeSupabase({ participants: [part({ event_slug: 'other-event', amount_due_cents: 5000 })], agreements: [] })
    expect(await eventAccessGates(member, SLUG)).toEqual({ payment: true, docusign: true, unlocked: true })
  })

  it('a free registration passes payment whatever its status', async () => {
    for (const amount of [0, null]) {
      db = fakeSupabase({ participants: [part({ amount_due_cents: amount, status: 'pending' })], agreements: [] })
      expect((await eventAccessGates(member, SLUG)).payment, String(amount)).toBe(true)
    }
  })

  it('an amount owed and unpaid fails payment, and locks', async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 1, status: 'pending' })], agreements: [] })
    expect(await eventAccessGates(member, SLUG)).toEqual({ payment: false, docusign: true, unlocked: false })
  })

  it('an amount owed and confirmed passes', async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 5000, status: 'confirmed' })], agreements: [] })
    expect(await eventAccessGates(member, SLUG)).toEqual({ payment: true, docusign: true, unlocked: true })
  })

  it('an invoiced registration needs invoice_paid_at, whatever the status', async () => {
    db = fakeSupabase({
      participants: [part({ amount_due_cents: 5000, status: 'confirmed', invoice_requested: true, invoice_paid_at: null })],
      agreements: [],
    })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(false)
    db = fakeSupabase({
      participants: [part({ amount_due_cents: 5000, status: 'pending', invoice_requested: true, invoice_paid_at: '2026-11-01' })],
      agreements: [],
    })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(true)
  })

  it("reads the participant's own individual payment status", async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 5000 }, { individual_payment_status: 'paid' })], agreements: [] })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(true)
    db = fakeSupabase({
      participants: [part({ amount_due_cents: 5000, status: 'confirmed' }, { individual_payment_status: 'pending' })],
      agreements: [],
    })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(false)
  })

  it('every participation must pass; one unpaid fails the member', async () => {
    db = fakeSupabase({
      participants: [
        part({ amount_due_cents: 5000, status: 'confirmed' }, { id: 'p-1' }),
        part({ amount_due_cents: 5000, status: 'pending' }, { id: 'p-2' }),
      ],
      agreements: [],
    })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(false)
  })

  it('reads a registration embedded as an array', async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 5000, status: 'pending' }, {}, true)], agreements: [] })
    expect((await eventAccessGates(member, SLUG)).payment).toBe(false)
  })
})

describe('eventAccessGates — envelope statuses', () => {
  it('a completed envelope is not overwritten by a later outstanding one', async () => {
    db = fakeSupabase({
      participants: [part({}, { date_of_birth: MINOR_DOB })],
      agreements: [
        { participant_id: 'p-1', event_slug: SLUG, status: 'completed' },
        { participant_id: 'p-1', event_slug: SLUG, status: 'voided' },
      ],
    })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(true)
  })

  it('a later completed envelope replaces an outstanding one', async () => {
    db = fakeSupabase({
      participants: [part({}, { date_of_birth: MINOR_DOB })],
      agreements: [
        { participant_id: 'p-1', event_slug: SLUG, status: 'sent' },
        { participant_id: 'p-1', event_slug: SLUG, status: 'completed' },
      ],
    })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(true)
  })

  it("ignores another event's envelope and one with no participant", async () => {
    db = fakeSupabase({
      participants: [part({}, { date_of_birth: ADULT_DOB })],
      agreements: [
        { participant_id: 'p-1', event_slug: 'other-event', status: 'sent' },
        { participant_id: null, event_slug: SLUG, status: 'sent' },
      ],
    })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(true)
  })
})

describe('reportEventAccessGates', () => {
  it('returns the gates and logs nothing when unlocked', async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 0 })], agreements: [] })
    expect(await reportEventAccessGates(member, SLUG)).toEqual({ payment: true, docusign: true, unlocked: true })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('logs who would be blocked, naming each missing gate, and never denies', async () => {
    db = fakeSupabase({
      participants: [part({ amount_due_cents: 5000, status: 'pending' }, { date_of_birth: MINOR_DOB })],
      agreements: [],
    })
    const gates = await reportEventAccessGates(member, SLUG)
    expect(gates).toEqual({ payment: false, docusign: false, unlocked: false })
    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(logActivity).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      category: 'event',
      action: 'access_gate_would_block',
      summary: `Would be blocked from ${SLUG} (report-only): payment + DocuSign`,
      metadata: { eventSlug: SLUG, payment: false, docusign: false, mode: 'report_only' },
      actorType: 'system',
    })
  })

  it('names only the gate that failed', async () => {
    db = fakeSupabase({ participants: [part({ amount_due_cents: 5000, status: 'pending' })], agreements: [] })
    await reportEventAccessGates(member, SLUG)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ summary: `Would be blocked from ${SLUG} (report-only): payment` })
    logActivity.mockClear()
    db = fakeSupabase({ participants: [part({}, { date_of_birth: MINOR_DOB })], agreements: [] })
    await reportEventAccessGates(member, SLUG)
    expect(logActivity.mock.calls[0][0]).toMatchObject({ summary: `Would be blocked from ${SLUG} (report-only): DocuSign` })
  })

  it('a failing logger does not fail the check', async () => {
    logActivity.mockRejectedValueOnce(new Error('log down'))
    db = fakeSupabase({ participants: [part({ amount_due_cents: 5000 })], agreements: [] })
    await expect(reportEventAccessGates(member, SLUG)).resolves.toMatchObject({ unlocked: false })
  })
})

describe('reportEnrollmentGate — the log entry', () => {
  it('records kind, container and mode, naming the container', async () => {
    db = fakeSupabase({ members: [{ id: MEMBER_ID, date_of_birth: MINOR_DOB }], participants: [], agreements: [] })
    await reportEnrollmentGate({ id: MEMBER_ID }, { kind: 'workshop', containerId: 'w-1', containerName: 'Rocketry' })
    expect(logActivity).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      category: 'membership',
      action: 'access_gate_would_block',
      summary: 'Minor would be blocked from workshop Rocketry (report-only): participation agreement',
      metadata: { kind: 'workshop', containerId: 'w-1', gate: 'minor_agreement', mode: 'report_only' },
      actorType: 'system',
    })
  })

  it('falls back to the container id, and says enforced when the flag is on', async () => {
    vi.stubEnv('ACCESS_GATES_ENFORCE', 'true')
    db = fakeSupabase({ members: [{ id: MEMBER_ID, date_of_birth: MINOR_DOB }], participants: [], agreements: [] })
    await reportEnrollmentGate({ id: MEMBER_ID }, { kind: 'cohort', containerId: 'c-1' })
    expect(logActivity.mock.calls[0][0]).toMatchObject({
      summary: 'Minor would be blocked from cohort c-1 (report-only): participation agreement',
      metadata: { mode: 'enforced' },
    })
  })

  it('a failing logger does not fail the check', async () => {
    logActivity.mockRejectedValueOnce(new Error('log down'))
    db = fakeSupabase({ members: [{ id: MEMBER_ID, date_of_birth: MINOR_DOB }], participants: [], agreements: [] })
    await expect(reportEnrollmentGate({ id: MEMBER_ID }, { kind: 'cohort', containerId: 'c-1' })).resolves.toEqual({
      minorAgreement: false,
      unlocked: false,
    })
  })
})
