// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// lib/audit/webhook.ts (S5 A13a): which stored row owns a provider's event, and whose
// chain the event goes on. BF-4's default: a tenant's event on Stellr's chain, with
// the owning tenant in the metadata.

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('no ambient client in these tests') } }))

const { noteWebhook, ownerChain, stripeEventNote, stripeEventOwner, webhookEvent } = await import('./webhook')
const { resolveTenant } = await import('./route')

const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const REG = 'cccccccc-0000-4000-8000-00000000000c'
const AGREEMENT = 'dddddddd-0000-4000-8000-00000000000d'

/** A client whose tables answer with these rows, matched on one column. */
function fakeDb(rows: Record<string, Record<string, unknown>[]>, opts: { fail?: string } = {}) {
  const reads: string[] = []
  const from = vi.fn((table: string) => {
    let col = ''
    let val: unknown
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => ((col = c), (val = v), q),
      limit: () => q,
      maybeSingle: async () => {
        reads.push(`${table}.${col}`)
        if (opts.fail === table) return { data: null, error: { message: 'down' } }
        return { data: (rows[table] ?? []).find((r) => r[col] === val) ?? null, error: null }
      },
    }
    return q
  })
  return { db: { from } as never, reads, from }
}

const event = (type: string, object: Record<string, unknown>) => ({ id: 'evt_test1', type, data: { object } }) as unknown as Stripe.Event

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('stripeEventOwner: the payload names the row, never the tenant', () => {
  it('a registration checkout, an individual seat and a registration invoice name the registration', () => {
    expect(stripeEventOwner(event('checkout.session.completed', { metadata: { registrationId: REG } }))).toEqual({ registrationId: REG })
    expect(stripeEventOwner(event('checkout.session.completed', { metadata: {}, client_reference_id: REG }))).toEqual({ registrationId: REG })
    expect(stripeEventOwner(event('checkout.session.async_payment_succeeded', { metadata: { isIndividualGroupPayment: 'true', registrationId: REG } }))).toEqual({ registrationId: REG })
    expect(stripeEventOwner(event('invoice.paid', { metadata: { registrationId: REG, isGroup: 'true' } }))).toEqual({ registrationId: REG })
  })

  it("Stellr's own products name no row", () => {
    for (const type of ['membership', 'mentoring_topup', 'coaching_topup', 'coaching_request_pay', 'entitlement_booking', 'workshop_enrollment', 'workshop_topup', 'store_order']) {
      expect(stripeEventOwner(event('checkout.session.completed', { metadata: { type, registrationId: REG }, client_reference_id: REG })), type).toBeNull()
    }
    expect(stripeEventOwner(event('invoice.paid', { metadata: { type: 'membership_invoice' } }))).toBeNull()
    expect(stripeEventOwner(event('invoice.paid', { metadata: {} }))).toBeNull()
    expect(stripeEventOwner(event('customer.subscription.deleted', { id: 'sub_1' }))).toBeNull()
    expect(stripeEventOwner(event('price.updated', { id: 'price_1' }))).toBeNull()
  })

  it('a refund names the payment intent it refunds', () => {
    expect(stripeEventOwner(event('charge.refunded', { payment_intent: 'pi_123' }))).toEqual({ paymentIntent: 'pi_123' })
    expect(stripeEventOwner(event('charge.refunded', { payment_intent: { id: 'pi_456' } }))).toEqual({ paymentIntent: 'pi_456' })
    expect(stripeEventOwner(event('charge.refunded', { payment_intent: null }))).toBeNull()
  })

  it('the note targets the processed-event row and keeps the event type', () => {
    expect(stripeEventNote(event('checkout.session.completed', { metadata: { registrationId: REG } }))).toEqual({
      owner: { registrationId: REG },
      target: { table: 'stripe_webhook_events', id: 'evt_test1' },
      metadata: { event_type: 'checkout.session.completed' },
    })
    expect(stripeEventNote(event('price.updated', {}))).not.toHaveProperty('owner')
  })
})

describe('ownerChain: the stored row gives the tenant', () => {
  it("a Stellr row goes on Stellr's chain", async () => {
    const { db } = fakeDb({ registrations: [{ id: REG, tenant_id: STELLR_TENANT_ID }] })
    expect(await ownerChain({ registrationId: REG }, db)).toEqual({ tenantId: STELLR_TENANT_ID, metadata: {} })
  })

  it("BF-4 default: a tenant's row goes on Stellr's chain, the owner in the metadata", async () => {
    const { db } = fakeDb({ registrations: [{ id: REG, tenant_id: TENANT_B }], agreements: [{ id: AGREEMENT, tenant_id: TENANT_B }] })
    const expected = { tenantId: STELLR_TENANT_ID, metadata: { owner_tenant_id: TENANT_B } }
    expect(await ownerChain({ registrationId: REG }, db)).toEqual(expected)
    expect(await ownerChain({ agreementId: AGREEMENT }, db)).toEqual(expected)
    expect(await ownerChain({ rowTenantId: TENANT_B }, db)).toEqual(expected)
  })

  it('a missing row, a row with no tenant, or an id that is not one is unresolved, never Stellr', async () => {
    const { db, from } = fakeDb({ registrations: [{ id: REG, tenant_id: null }] })
    const unresolved = { tenantId: null, metadata: { tenant_unresolved: true } }
    expect(await ownerChain({ registrationId: 'eeeeeeee-0000-4000-8000-00000000000e' }, db)).toEqual(unresolved)
    expect(await ownerChain({ registrationId: REG }, db)).toEqual(unresolved)
    expect(await ownerChain({ rowTenantId: null }, db)).toEqual(unresolved)
    from.mockClear()
    expect(await ownerChain({ registrationId: "x' or 1=1" }, db)).toEqual(unresolved)
    expect(await ownerChain({ agreementId: 'nope' }, db)).toEqual(unresolved)
    expect(await ownerChain({ paymentIntent: 'not_a_pi' }, db)).toEqual(unresolved)
    expect(from).not.toHaveBeenCalled()
  })

  it("a payment intent is looked for on the registration, then the seat, then the group invoice; none of them is Stellr's product", async () => {
    const seat = fakeDb({ participants: [{ stripe_payment_intent_id: 'pi_seat', tenant_id: TENANT_B }] })
    expect(await ownerChain({ paymentIntent: 'pi_seat' }, seat.db)).toEqual({ tenantId: STELLR_TENANT_ID, metadata: { owner_tenant_id: TENANT_B } })
    expect(seat.reads).toEqual(['registrations.stripe_payment_intent_id', 'participants.stripe_payment_intent_id'])
    const store = fakeDb({})
    expect(await ownerChain({ paymentIntent: 'pi_store' }, store.db)).toEqual({ tenantId: STELLR_TENANT_ID, metadata: {} })
    expect(store.reads).toEqual(['registrations.stripe_payment_intent_id', 'participants.stripe_payment_intent_id', 'group_invoices.payment_intent_id'])
  })

  it('a read that fails is unresolved through resolveTenant, not Stellr', async () => {
    const { db } = fakeDb({}, { fail: 'registrations' })
    await expect(ownerChain({ registrationId: REG }, db)).rejects.toThrow()
    expect(await resolveTenant({ owner: { registrationId: REG } }, { db })).toEqual({ tenantId: null, metadata: { tenant_unresolved: true } })
    expect(await resolveTenant({ owner: { paymentIntent: 'pi_x' } }, { db })).toEqual({ tenantId: null, metadata: { tenant_unresolved: true } })
  })
})

describe('webhookEvent', () => {
  it("a delivery nobody verified says so, on Stellr's chain, with no target", () => {
    expect(webhookEvent('resend', new Request('https://www.test/x'))).toEqual({
      actor: { webhook: 'resend' },
      tenant: { stellr: true },
      target: undefined,
      metadata: { verified: false },
    })
  })

  it('later notes add to earlier ones, per request', () => {
    const req = new Request('https://www.test/x')
    const other = new Request('https://www.test/y')
    noteWebhook(req, { metadata: { event_type: 'envelope-completed' } })
    noteWebhook(req, { owner: { agreementId: AGREEMENT }, target: { table: 'agreements', id: AGREEMENT } })
    expect(webhookEvent('docusign', req)).toEqual({
      actor: { webhook: 'docusign' },
      tenant: { owner: { agreementId: AGREEMENT } },
      target: { table: 'agreements', id: AGREEMENT },
      metadata: { event_type: 'envelope-completed', verified: true },
    })
    expect(webhookEvent('docusign', other).metadata).toEqual({ verified: false })
  })
})
