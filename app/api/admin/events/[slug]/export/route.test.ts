// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRecorder, type DbCall, type DbResult } from '@/test/registration/fixtures'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// esign-native-engine.9: the roster CSV carries 'Quote opt-out' and 'Digital comms
// opt-out' beside media_ok, read from the stored read-back (lib/roster-optouts.ts)
// for either signing engine. Stellr's alone, as media_ok is: a tenant's export
// leaves them blank and reads no agreement.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const rec = createRecorder()

const h = vi.hoisted(() => ({
  scope: { tenantId: '' as string },
  roster: vi.fn(),
  media: vi.fn(async (..._a: unknown[]) => new Map<string, { status: string; reason: string }>()),
}))

vi.mock('@/lib/authz', () => ({
  requireEventRoute: async () => ({ ok: true, scope: { tenantId: h.scope.tenantId, eventSlugs: null } }),
}))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/record-access-log', () => ({ logRecordAccess: async () => {} }))
vi.mock('@/lib/event-admin', () => ({ getEventRoster: h.roster }))
vi.mock('@/lib/survey/media', async (orig) => ({ ...(await orig<typeof import('@/lib/survey/media')>()), mediaForParticipants: h.media }))
vi.mock('@/lib/tenancy/load-scoped', () => ({ enforcedTenantFilter: () => null }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => rec.client() }))

const { GET } = await import('./route')

const person = (id: string, memberId: string | null) => ({
  id, first_name: 'Sam', last_name: id, email: `${id}@example.com`, event_role: 'participant', school_name: null,
  grade: null, gender: null, date_of_birth: null, t_shirt_size: null, dietary_requirements: [], health_conditions: null,
  emergency_contact_first_name: null, emergency_contact_last_name: null, emergency_contact_relationship: null,
  emergency_contact_email: null, emergency_contact_phone: null, paid: true, payment_pill: 'link_paid',
  docusign: 'completed', docusign_pill: 'completed', checked_in_at: null, member_id: memberId,
})

const AGREEMENTS = [
  // p-1: both boxes ticked, read back by the in-app engine.
  { id: 'a1', participant_id: 'p-1', member_id: null, completed_at: '2026-10-01', reused_from: null, media_opt_out: null, quote_opt_out: true, digital_comms_opt_out: true, form_opt_outs: { QuoteOptOut: true, DigitalCommsOptOut: true } },
  // p-2: a DocuSign form read with both boxes unticked.
  { id: 'a2', participant_id: 'p-2', member_id: null, completed_at: '2026-10-01', reused_from: null, media_opt_out: null, quote_opt_out: null, digital_comms_opt_out: null, form_opt_outs: { QuoteOptOut: false, DigitalCommsOptOut: false } },
]

function csvRows(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((l) => l.split(','))
}

async function run() {
  const res = await GET(new Request('https://app.test/api/admin/events/demo/export'), { params: Promise.resolve({ slug: 'demo' }) })
  return csvRows(await res.text())
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.roster.mockResolvedValue({ groups: [{ type: 'individual', groupLabel: null, participants: [person('p-1', null), person('p-2', null), person('p-3', null)] }] })
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table !== 'agreements') return undefined
    const ids = (c.filters.find((f) => f[0] === 'in' && f[1] === 'participant_id')?.[2] ?? []) as string[]
    return { data: AGREEMENTS.filter((a) => ids.includes(a.participant_id)), error: null }
  })
})

describe('GET /api/admin/events/[slug]/export: opt-out columns', () => {
  it("Stellr: 'Quote opt-out' and 'Digital comms opt-out' sit beside media_ok and its note, yes / no / blank", async () => {
    h.scope.tenantId = STELLR_TENANT_ID
    const [header, ...rows] = await run()
    const at = header.indexOf('media_ok')
    expect(header.slice(at, at + 4)).toEqual(['media_ok', 'Media Note', 'Quote opt-out', 'Digital comms opt-out'])
    const q = header.indexOf('Quote opt-out')
    const d = header.indexOf('Digital comms opt-out')
    const byId = new Map(rows.map((r) => [r[3], r]))
    expect([byId.get('p-1')![q], byId.get('p-1')![d]]).toEqual(['yes', 'yes'])
    expect([byId.get('p-2')![q], byId.get('p-2')![d]]).toEqual(['no', 'no'])
    // No signed form on file: not known.
    expect([byId.get('p-3')![q], byId.get('p-3')![d]]).toEqual(['', ''])
    // Every row keeps the header's width.
    for (const r of rows) expect(r).toHaveLength(header.length)
  })

  it("a tenant's export leaves them blank and reads no agreement", async () => {
    h.scope.tenantId = CANARY
    const [header, ...rows] = await run()
    const q = header.indexOf('Quote opt-out')
    const d = header.indexOf('Digital comms opt-out')
    expect(q).toBeGreaterThan(-1)
    expect(d).toBe(q + 1)
    for (const r of rows) expect([r[q], r[d]]).toEqual(['', ''])
    expect(rec.calls.some((c) => c.table === 'agreements')).toBe(false)
    expect(h.media).not.toHaveBeenCalled()
  })
})
