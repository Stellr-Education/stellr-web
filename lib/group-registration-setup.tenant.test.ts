// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 A8b. The admin "Finish registration setup" join link and invoice carry the
// registration's tenant: the join token writes it as tenant_id, and the invoice passes
// it on for its ledger row (lib/group-invoice). A row the backfill has not reached
// (NULL) is Stellr's, the value the derivation trigger stamps today.

const h = vi.hoisted(() => ({
  reg: null as Record<string, unknown> | null,
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  invoice: vi.fn(async (..._a: unknown[]) => ({ invoiceId: 'in_1' })),
}))

vi.mock('@/lib/stripe', () => ({
  stripeClient: () => ({ prices: { retrieve: async () => ({ unit_amount: 9700, currency: 'usd' }) } }),
}))
vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ stripePriceId: 'price_placeholder' }) }))
vi.mock('@/lib/google-sheets', () => ({ createGroupRegistrationSheet: vi.fn(), isGoogleSheetsConfigured: () => false }))
vi.mock('@/lib/email', () => ({ groupConfirmationEmail: vi.fn(), sendEmail: vi.fn() }))
vi.mock('@/lib/group-invoice', () => ({ createAndSendGroupInvoice: h.invoice, findGroupInvoice: async () => null }))
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: vi.fn() }))
vi.mock('@/lib/check-in-codes', () => ({ checkInCodeLink: vi.fn() }))

const db = {
  from: (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: table === 'registrations' ? h.reg : null, error: null })
    chain.insert = async (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return { error: null } }
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
    return chain
  },
}

const { finishGroupSetup } = await import('./group-registration-setup')

const REG = {
  id: 'reg-1', type: 'group', status: 'pending', event_slug: 'colorado', event_title: 'Colorado SDC',
  teacher_first_name: 'T', teacher_last_name: 'Teacher', teacher_email: 'teacher@example.com', teacher_poc_email: null,
  teacher_member_id: null, school_name: 'Lincoln High', school_address_state: 'CO', spreadsheet_id: null,
  invoice_requested: true, invoice_paid_at: null, amount_due_cents: 29_100, member_pays_individually: false,
  details_method: 'sheet', adult_count: 1, student_count: 2, registrant_role: 'teacher', late_joiner_payer: null,
}

beforeEach(() => {
  h.inserts.length = 0
  h.invoice.mockClear()
})

describe('finishGroupSetup (S5 A8b)', () => {
  for (const [label, tenant] of [['Stellr’s', STELLR_TENANT_ID], ['NULL (Stellr’s)', null]] as const) {
    it(`the join token carries the registration’s tenant: ${label}`, async () => {
      h.reg = { ...REG, tenant_id: tenant }
      const out = await finishGroupSetup(db as never, 'reg-1', ['join_link'])
      expect(out?.join_link).toBe('created')
      expect(h.inserts).toEqual([{
        table: 'group_join_tokens',
        row: expect.objectContaining({ registration_id: 'reg-1', event_slug: 'colorado', tenant_id: STELLR_TENANT_ID }),
      }])
    })

    it(`the invoice is handed the registration’s tenant: ${label}`, async () => {
      h.reg = { ...REG, tenant_id: tenant }
      const out = await finishGroupSetup(db as never, 'reg-1', ['invoice'])
      expect(out?.invoice).toBe('sent')
      expect(h.invoice.mock.calls[0][2]).toMatchObject({ registrationId: 'reg-1', tenantId: STELLR_TENANT_ID })
    })
  }
})
