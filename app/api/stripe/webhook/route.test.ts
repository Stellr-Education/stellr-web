import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Stripe from 'stripe'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'

// Fixture-driven tests for the Stripe webhook's money paths (deep review PAY-13).
// Covers the three fixes in this PR:
//   PAY-3 — a dahlia-shaped renewal invoice.paid extends expires_at.
//   PAY-4 — a second checkout.session.completed for one registration is refunded,
//           not re-confirmed, and never overwrites the first payment intent.
//   PAY-6 — a checkout.session.completed with payment_status 'unpaid' fulfils
//           nothing (delayed ACH-style payment not yet cleared).

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => h.revalidateTag(...args),
  unstable_cache: (fn: unknown) => fn,
}))

// Spies must be created in a hoisted block: vi.mock factories are hoisted above
// normal top-level consts, and route.ts is imported (and its mock factories run)
// before those consts would initialise.
const h = vi.hoisted(() => ({
  confirmRegistration: vi.fn(async () => {}),
  handleStoreOrderPaid: vi.fn(async () => {}),
  finalizeRegistrationMerch: vi.fn(async () => {}),
  finalizeRedemption: vi.fn(async () => {}),
  notifyCommunityAdmins: vi.fn(async () => {}),
  recordExternalChargeRefunds: vi.fn(async () => ({ recorded: 0 })),
  logActivity: vi.fn(async () => {}),
  fireTierPurchased: vi.fn(async () => {}),
  grantTier: vi.fn(async () => ({})),
  rosterAfterPaidBooking: vi.fn(async (): Promise<{ rostered: boolean; reason?: string }> => ({ rostered: true })),
  scheduleFromRequest: vi.fn(async () => {}),
  confirmPaidBooking: vi.fn(async () => 'b1'),
  redeemCoupon: vi.fn(async () => {}),
  grantTierAllocations: vi.fn(async () => {}),
  grantPurchasedLot: vi.fn(async () => {}),
  getOfferingTarget: vi.fn(async (): Promise<{ type: string; cohortId?: string } | null> => null),
  sendEmail: vi.fn(async () => {}),
  refundsCreate: vi.fn(async () => ({ id: 're_dup' })),
  // deep review PAY-N4: cancel the prior Stripe subscription when a new one activates.
  subscriptionsCancel: vi.fn(async () => ({ id: 'sub_cancelled' })),
  // deep review PAY-15: a no-op spy standing in for the test-key guard, so a test
  // can prove the money paths call it (the real guard only throws on a prod
  // deployment holding sandbox keys, which the test env is not).
  assertLiveCredentials: vi.fn(),
  // Price events refresh the cached prices public pages show (lib/price-cache).
  revalidateTag: vi.fn(),
  // group-payment-options.10: a caught failure reaches app_errors through this.
  reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}),
}))

// ── A tiny in-memory Supabase stand-in: enough for select/eq/neq/maybeSingle +
// update(...).eq(...) + insert. Writes mutate the fixture rows in place (so a
// later read sees them) and are recorded for assertions.
type Row = Record<string, unknown>
// `opts.failUpdate(table)` → that table's update() resolves with a Supabase
// {error} (deep review PAY-5), letting a test prove a money-path write failure
// aborts the webhook instead of being swallowed. Default (omitted) keeps every
// write succeeding, so existing tests are unaffected.
// `failUpdate` also sees the values being written, so a test can fail one write
// on a table (the share columns) while the others on it succeed.
function makeDb(tables: Record<string, Row[]>, opts?: { failUpdate?: (table: string, set: Row) => boolean }) {
  const updates: { table: string; set: Row }[] = []
  const inserts: { table: string; rows: Row[] }[] = []
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let pendingUpdate: Row | null = null
    const matched = () => (tables[table] ??= []).filter((r) => filters.every((f) => f(r)))
    const run = () => {
      if (pendingUpdate) {
        if (opts?.failUpdate?.(table, pendingUpdate)) {
          return { data: null, error: { message: `simulated ${table} write failure` } }
        }
        const rows = matched()
        for (const r of rows) Object.assign(r, pendingUpdate)
        updates.push({ table, set: pendingUpdate })
        return { data: rows, error: null }
      }
      return { data: matched(), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      // Minimal PostgREST `.or('col.is.null,col.eq.val')` support for
      // markIndividualPayment's "is the whole group settled?" check (PAY-7 path).
      or: (expr: string) => {
        const clauses = expr.split(',').map((part) => {
          const [col, op, ...rest] = part.split('.')
          const val = rest.join('.')
          return (r: Row) => (op === 'is' && val === 'null' ? r[col] == null : String(r[col]) === val)
        })
        filters.push((r) => clauses.some((c) => c(r)))
        return q
      },
      limit: () => q,
      order: () => q,
      not: () => q,
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      single: async () => ({ data: matched()[0] ?? null, error: null }),
      update: (set: Row) => ((pendingUpdate = set), q),
      insert: (payload: Row | Row[]) => {
        const rows = Array.isArray(payload) ? payload : [payload]
        inserts.push({ table, rows })
        ;(tables[table] ??= []).push(...rows)
        return q
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return q
  }
  return { db: { from: builder }, updates, inserts }
}

let current: ReturnType<typeof makeDb>
let currentEvent: Stripe.Event

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => current.db }))
vi.mock('@/lib/stripe', () => {
  const stub = {
    webhooks: { constructEvent: () => currentEvent },
    refunds: { create: h.refundsCreate },
    subscriptions: { cancel: h.subscriptionsCancel },
  }
  return { requireStripe: () => stub, stripeClient: () => stub, STRIPE_API_VERSION: 'test' }
})
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: h.assertLiveCredentials }))
vi.mock('@/lib/app-errors', () => ({ reportError: h.reportError }))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: h.confirmRegistration }))
vi.mock('@/lib/store/orders', () => ({ handleStoreOrderPaid: h.handleStoreOrderPaid }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: h.finalizeRegistrationMerch }))
vi.mock('@/lib/refunds/redeem', () => ({ finalizeRedemption: h.finalizeRedemption }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notifyCommunityAdmins }))
vi.mock('@/lib/refunds/stripe-webhook', () => ({ recordExternalChargeRefunds: h.recordExternalChargeRefunds }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/membership-grants', () => ({ fireTierPurchased: h.fireTierPurchased, grantTier: h.grantTier }))
vi.mock('@/lib/mentoring', () => ({ rosterAfterPaidBooking: h.rosterAfterPaidBooking }))
vi.mock('@/lib/coaching-requests', () => ({ scheduleFromRequest: h.scheduleFromRequest }))
vi.mock('@/lib/entitlements', () => ({
  confirmPaidBooking: h.confirmPaidBooking,
  redeemCoupon: h.redeemCoupon,
  grantTierAllocations: h.grantTierAllocations,
  grantPurchasedLot: h.grantPurchasedLot,
  getOfferingTarget: h.getOfferingTarget,
}))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  individualConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
}))

import { POST } from './route'

function post(event: Stripe.Event) {
  currentEvent = event
  const req = new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=sig' },
    body: '{}',
  })
  return POST(req as never)
}

async function readRow(table: string, id: string): Promise<Row | null> {
  const b = current.db.from(table) as {
    select: () => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Row | null }> } }
  }
  return (await b.select().eq('id', id).maybeSingle()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

describe('invoice.paid renewal (PAY-3: dahlia subscription shape)', () => {
  it('extends expires_at from parent.subscription_details.subscription', async () => {
    current = makeDb({
      member_memberships: [
        { id: 'mm1', stripe_subscription_id: 'sub_1', renewal_status: 'active', billing_interval: 'monthly', expires_at: '2026-01-01' },
      ],
      stripe_webhook_events: [],
    })
    const periodEnd = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000)
    const res = await post({
      id: 'evt_renew', type: 'invoice.paid',
      data: { object: {
        // dahlia: NO top-level `subscription`; it lives under parent.
        metadata: {},
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [{ period: { end: periodEnd } }] },
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(await readRow('member_memberships', 'mm1')).toMatchObject({ expires_at: '2026-12-01' })
  })
})

describe('checkout.session.completed duplicate (PAY-4)', () => {
  const sessionFor = (id: string, pi: string) => ({
    id, payment_status: 'paid', payment_intent: pi,
    metadata: { registrationId: 'r1' }, client_reference_id: 'r1',
    amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
  })

  it('refunds the second payment and keeps the first intent', async () => {
    current = makeDb({
      registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }],
      participants: [],
      stripe_webhook_events: [],
    })

    await post({ id: 'evt_a', type: 'checkout.session.completed', data: { object: sessionFor('cs_a', 'pi_1') } } as unknown as Stripe.Event)
    await post({ id: 'evt_b', type: 'checkout.session.completed', data: { object: sessionFor('cs_b', 'pi_2') } } as unknown as Stripe.Event)

    // confirmRegistration ran exactly once (the first payment).
    expect(h.confirmRegistration).toHaveBeenCalledTimes(1)
    // The duplicate (pi_2) was refunded, tagged, idempotency-keyed.
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_2', metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      expect.objectContaining({ idempotencyKey: 'dup-cs_b' }),
    )
    // The registration still references the FIRST intent.
    expect(await readRow('registrations', 'r1')).toMatchObject({ stripe_payment_intent_id: 'pi_1' })
    expect(h.notifyCommunityAdmins).toHaveBeenCalledTimes(1)
    // deep review PAY-15: the auto-refund path must consult the test-key guard.
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })
})

describe('membership activation cancels a stranded prior subscription (PAY-N4)', () => {
  const membershipSession = (subscription: string) => ({
    id: 'cs_m', payment_status: 'paid', subscription,
    metadata: { type: 'membership', memberId: 'm1', tierId: 't_new', billingInterval: 'annual' },
    amount_total: 9900, currency: 'usd', customer: null, customer_details: null,
  })

  it('cancels the prior Stripe subscription, never the new one', async () => {
    current = makeDb({
      // The member already holds an active subscription on a DIFFERENT Stripe sub.
      member_memberships: [
        { id: 'mm_old', member_id: 'm1', tier_id: 't_old', renewal_status: 'active', stripe_subscription_id: 'sub_old' },
      ],
      membership_tiers: [{ id: 't_new', name: 'Innovator' }],
      stripe_webhook_events: [],
    })
    const res = await post({ id: 'evt_m', type: 'checkout.session.completed', data: { object: membershipSession('sub_new') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    // The stranded prior subscription was cancelled so Stripe stops billing it.
    expect(h.subscriptionsCancel).toHaveBeenCalledWith('sub_old')
    // The subscription we just activated is NEVER cancelled.
    expect(h.subscriptionsCancel).not.toHaveBeenCalledWith('sub_new')
    // The old DB row was expired and a new active row inserted.
    expect(await readRow('member_memberships', 'mm_old')).toMatchObject({ renewal_status: 'expired' })
    expect(current.inserts.some((i) => i.table === 'member_memberships')).toBe(true)
  })

  it('does not cancel anything when there is no prior subscription', async () => {
    current = makeDb({
      member_memberships: [],
      membership_tiers: [{ id: 't_new', name: 'Innovator' }],
      stripe_webhook_events: [],
    })
    await post({ id: 'evt_m2', type: 'checkout.session.completed', data: { object: membershipSession('sub_new') } } as unknown as Stripe.Event)
    expect(h.subscriptionsCancel).not.toHaveBeenCalled()
  })
})

describe('members-pay-individually seat settlement (PAY-7 / PAY-N1)', () => {
  // participants.email is the frozen registration-time address; the member signed
  // in / pays under a different (Clerk) address carried as participantEmail. The
  // seat must still be settled, by participant id.
  const seatRows = (intent: string | null = null, status = 'pending') => ({
    participants: [{
      id: 'pX', registration_id: 'r1', email: 'old@school.org',
      individual_payment_status: status, stripe_payment_intent_id: intent,
      first_name: 'Ada', last_name: 'L', membership_id: 'M1',
    }],
    registrations: [{ id: 'r1', status: 'pending', event_title: 'Nevada 2027' }],
    stripe_webhook_events: [],
  })
  const seatSession = (id: string, pi: string, extra: Record<string, unknown> = {}) => ({
    id, payment_status: 'paid', payment_intent: pi,
    metadata: { registrationId: 'r1', participantId: 'pX', participantEmail: 'new@home.com', isIndividualGroupPayment: 'true', ...extra },
    customer: null, customer_details: null, amount_total: 7500, currency: 'usd',
  })

  it('settles the seat by participant id, not by the mismatched email (PAY-7)', async () => {
    current = makeDb(seatRows())
    const res = await post({ id: 'evt_seat', type: 'checkout.session.completed', data: { object: seatSession('cs_seat', 'pi_1') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    const seat = await readRow('participants', 'pX')
    expect(seat).toMatchObject({ individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' })
    // Whole group now settled → registration confirmed.
    expect(h.confirmRegistration).not.toHaveBeenCalled() // per-seat path confirms via direct update, not confirmRegistration
    expect(await readRow('registrations', 'r1')).toMatchObject({ status: 'confirmed' })
  })

  it('still settles by email for a pre-PAY-7 session that carries no participantId', async () => {
    current = makeDb({
      participants: [{
        id: 'pX', registration_id: 'r1', email: 'old@school.org',
        individual_payment_status: 'pending', stripe_payment_intent_id: null,
        first_name: 'Ada', last_name: 'L', membership_id: 'M1',
      }],
      registrations: [{ id: 'r1', status: 'pending', event_title: 'Nevada 2027' }],
      stripe_webhook_events: [],
    })
    const session = { id: 'cs_old', payment_status: 'paid', payment_intent: 'pi_1',
      metadata: { registrationId: 'r1', participantEmail: 'old@school.org', isIndividualGroupPayment: 'true' },
      customer: null, customer_details: null, amount_total: 7500, currency: 'usd' }
    await post({ id: 'evt_old', type: 'checkout.session.completed', data: { object: session } } as unknown as Stripe.Event)

    expect(await readRow('participants', 'pX')).toMatchObject({ individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_1' })
  })

  it('refunds a duplicate seat payment and keeps the first intent (PAY-N1)', async () => {
    // The seat already paid under pi_1; a second live session (pi_2) now completes.
    current = makeDb(seatRows('pi_1', 'paid'))
    const res = await post({ id: 'evt_dup_seat', type: 'checkout.session.completed', data: { object: seatSession('cs_seat2', 'pi_2') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_2', metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      expect.objectContaining({ idempotencyKey: 'dup-cs_seat2' }),
    )
    // The seat still references the FIRST intent — the duplicate never overwrote it.
    expect(await readRow('participants', 'pX')).toMatchObject({ stripe_payment_intent_id: 'pi_1' })
    expect(h.notifyCommunityAdmins).toHaveBeenCalledTimes(1)
  })

  it('a late retry of the duplicate seat refund that gets charge_already_refunded is done: 200, no second alert (PAY-N1, legacy-12.4)', async () => {
    // The duplicate (pi_2) was refunded on an earlier delivery; this retry comes
    // after Stripe's 24-hour idempotency window, so Stripe refuses the refund.
    current = makeDb(seatRows('pi_1', 'paid'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.refundsCreate.mockRejectedValueOnce(Object.assign(new Error('Charge has already been refunded.'), { type: 'StripeInvalidRequestError', code: 'charge_already_refunded' }))
    const res = await post({ id: 'evt_dup_seat_late', type: 'checkout.session.completed', data: { object: seatSession('cs_seat2', 'pi_2') } } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_2', metadata: expect.objectContaining({ reason: 'duplicate_individual_payment', source: 'stellr_app' }) }),
      { idempotencyKey: 'dup-cs_seat2' },
    )
    // Staff were told on the first delivery; the seat keeps the first intent and is not re-settled.
    expect(h.notifyCommunityAdmins).not.toHaveBeenCalled()
    expect(await readRow('participants', 'pX')).toMatchObject({ stripe_payment_intent_id: 'pi_1', individual_payment_status: 'paid' })
    // The event is recorded as processed, so Stripe stops retrying.
    expect(current.inserts.find((i) => i.table === 'stripe_webhook_events')).toBeDefined()
    vi.mocked(console.warn).mockRestore()
  })
})

describe('checkout.session.completed payment_status gate (PAY-6)', () => {
  it('fulfils nothing when payment_status is unpaid (delayed ACH)', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }], stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_unpaid', type: 'checkout.session.completed',
      data: { object: { id: 'cs_u', payment_status: 'unpaid', payment_intent: 'pi_u', metadata: { registrationId: 'r1' }, client_reference_id: 'r1' } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.confirmRegistration).not.toHaveBeenCalled()
    expect(h.handleStoreOrderPaid).not.toHaveBeenCalled()
    expect(h.finalizeRedemption).not.toHaveBeenCalled()
  })

  it('fulfils a store order once the async payment succeeds', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    await post({
      id: 'evt_async_ok', type: 'checkout.session.async_payment_succeeded',
      data: { object: { id: 'cs_s', payment_status: 'paid', metadata: { type: 'store_order', orderId: 'o1' } } },
    } as unknown as Stripe.Event)
    expect(h.handleStoreOrderPaid).toHaveBeenCalledTimes(1)
  })
})

describe('paid mentoring cohort booking: minor-agreement backstop', () => {
  const bookingEvent = (id: string) => ({
    id, type: 'checkout.session.completed',
    data: { object: {
      id: `cs_${id}`, payment_status: 'paid', payment_intent: `pi_${id}`,
      amount_total: 12000, currency: 'usd', customer: null, customer_details: null,
      metadata: { type: 'entitlement_booking', memberId: 'm1', offeringId: 'off1', creditAppliedCents: '0' },
    } },
  } as unknown as Stripe.Event)

  beforeEach(() => {
    h.getOfferingTarget.mockResolvedValue({ type: 'mentoring_cohort', cohortId: 'c1' })
  })
  afterEach(() => {
    h.getOfferingTarget.mockResolvedValue(null)
  })

  it('rosters and raises no alert when the gate lets them in', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    const res = await post(bookingEvent('evt_ok'))
    expect(res.status).toBe(200)
    expect(h.rosterAfterPaidBooking).toHaveBeenCalledWith('c1', 'm1')
    expect(h.notifyCommunityAdmins).not.toHaveBeenCalled()
    expect(h.logActivity).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'paid_booking_held' }))
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })

  it('keeps the payment, records it and alerts staff when the gate holds them out', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    h.rosterAfterPaidBooking.mockResolvedValueOnce({ rostered: false, reason: 'needs-agreement' })
    const res = await post(bookingEvent('evt_held'))

    expect(res.status).toBe(200)
    // Never dropped and never refunded automatically: the ledger seat stands.
    expect(h.confirmPaidBooking).toHaveBeenCalledTimes(1)
    expect(h.refundsCreate).not.toHaveBeenCalled()
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({
      memberId: 'm1',
      action: 'paid_booking_held',
      metadata: expect.objectContaining({ cohortId: 'c1', reason: 'needs-agreement', paymentIntent: 'pi_evt_held' }),
    }))
    expect(h.notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({
      type: 'action',
      body: expect.stringContaining('participation agreement'),
    }))
    // The payment is still logged as received.
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment_received' }))
  })

  it('keeps the payment and tells staff why when the cohort has been archived', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    h.rosterAfterPaidBooking.mockResolvedValueOnce({ rostered: false, reason: 'cohort-archived' })
    const res = await post(bookingEvent('evt_archived'))

    expect(res.status).toBe(200)
    expect(h.refundsCreate).not.toHaveBeenCalled()
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'paid_booking_held',
      summary: expect.stringContaining('archived'),
      metadata: expect.objectContaining({ reason: 'cohort-archived' }),
    }))
    expect(h.notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('archived') }))
    expect(h.notifyCommunityAdmins).toHaveBeenCalledWith(expect.objectContaining({ body: expect.not.stringContaining('participation agreement') }))
  })
})

describe('invoice.paid zero-amount guard (PAY-1)', () => {
  it('does NOT confirm an event registration on a $0 invoice', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending' }], stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_zero', type: 'invoice.paid',
      // The group invoice-ordering bug could finalise an empty $0 invoice that
      // Stripe auto-marks paid; amount_paid is then 0.
      data: { object: { id: 'in_zero', amount_paid: 0, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.confirmRegistration).not.toHaveBeenCalled()
  })

  it('confirms when the invoice genuinely paid (amount_paid > 0)', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'pending' }], stripe_webhook_events: [] })
    await post({
      id: 'evt_paid', type: 'invoice.paid',
      data: { object: { id: 'in_paid', amount_paid: 40500, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect(h.confirmRegistration).toHaveBeenCalledTimes(1)
    expect(h.confirmRegistration).toHaveBeenCalledWith('r1', false, { paidViaInvoice: true })
  })
})

describe('invoice.paid for a Checkout-issued invoice', () => {
  it('records nothing: no group ledger write, no registration confirmed', async () => {
    current = makeDb({ registrations: [{ id: 'r1', status: 'confirmed' }], group_invoices: [], stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_checkout_inv', type: 'invoice.paid',
      // Even if a group key were ever added by mistake, source=checkout wins.
      data: { object: { id: 'in_checkout', amount_paid: 8245, metadata: { source: 'checkout', checkoutRegistrationId: 'r1', registrationId: 'r1', isGroup: 'true' } } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.confirmRegistration).not.toHaveBeenCalled()
    expect(current.inserts.some((i) => i.table === 'group_invoices')).toBe(false)
    expect(current.updates.some((u) => u.table === 'group_invoices' || u.table === 'registrations')).toBe(false)
  })
})

describe('money-path write failure fails closed (PAY-5)', () => {
  const recorded = () => current.inserts.find((i) => i.table === 'stripe_webhook_events')

  it('a renewal expires_at write error returns 500 and does NOT record the event', async () => {
    current = makeDb(
      {
        member_memberships: [
          { id: 'mm1', stripe_subscription_id: 'sub_1', renewal_status: 'active', billing_interval: 'monthly', expires_at: '2026-01-01' },
        ],
        stripe_webhook_events: [],
      },
      { failUpdate: (t) => t === 'member_memberships' },
    )
    const periodEnd = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000)
    const res = await post({
      id: 'evt_renew_err', type: 'invoice.paid',
      data: { object: {
        metadata: {},
        parent: { subscription_details: { subscription: 'sub_1' } },
        lines: { data: [{ period: { end: periodEnd } }] },
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined() // not processed → Stripe retries
  })

  it('a capturePaymentIntent write error returns 500 and does NOT record the event', async () => {
    current = makeDb(
      {
        registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: null }],
        participants: [],
        stripe_webhook_events: [],
      },
      { failUpdate: (t) => t === 'registrations' },
    )
    const res = await post({
      id: 'evt_cap_err', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_a', payment_status: 'paid', payment_intent: 'pi_1',
        metadata: { registrationId: 'r1' }, client_reference_id: 'r1',
        amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined()
  })

  it('a grantTier write failure on an invoice membership returns 500 and does NOT record the event', async () => {
    // reason 'error' = a real insert failure, distinct from the benign skips.
    h.grantTier.mockResolvedValueOnce({ granted: false, reason: 'error' })
    current = makeDb({ stripe_webhook_events: [] })
    const res = await post({
      id: 'evt_grant_err', type: 'invoice.paid',
      data: { object: { id: 'in_m', amount_paid: 9900, metadata: { type: 'membership_invoice', memberId: 'm1', tierId: 't1' } } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(500)
    expect(recorded()).toBeUndefined()
  })

  it('still short-circuits an already-processed event (idempotency preserved)', async () => {
    current = makeDb({
      registrations: [{ id: 'r1', status: 'pending' }],
      stripe_webhook_events: [{ id: 'evt_dup', type: 'invoice.paid' }],
    })
    const res = await post({
      id: 'evt_dup', type: 'invoice.paid',
      data: { object: { id: 'in_x', amount_paid: 40500, metadata: { registrationId: 'r1' } } },
    } as unknown as Stripe.Event)

    expect((await res.json()) as unknown).toMatchObject({ duplicate: true })
    expect(h.confirmRegistration).not.toHaveBeenCalled()
  })
})

describe('price changes refresh the cached prices', () => {
  // The prices public pages show are cached for an hour (a shorter window made
  // their ISR pages re-render every minute, 21 Oct 2026), so a change in Stripe
  // has to drop the cache rather than wait the hour out.
  it.each(['price.created', 'price.updated', 'price.deleted', 'product.updated'])(
    '%s revalidates both price caches',
    async (type) => {
      current = makeDb({ stripe_webhook_events: [] })
      const res = await post({ id: `evt_${type}`, type, data: { object: { id: 'price_1' } } } as unknown as Stripe.Event)
      expect(res.status).toBe(200)
      expect(h.revalidateTag).toHaveBeenCalledWith('membership-prices', { expire: 0 })
      expect(h.revalidateTag).toHaveBeenCalledWith('event-prices', { expire: 0 })
    },
  )

  it('leaves the caches alone for every other event', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    await post({ id: 'evt_cust', type: 'customer.updated', data: { object: { id: 'cus_1' } } } as unknown as Stripe.Event)
    expect(h.revalidateTag).not.toHaveBeenCalled()
  })
})

// group-payment-options.10: the seat was paid, so a share-record failure must not
// 500 the webhook (which would re-run the whole seat on every retry); it is
// reported to app_errors and the webhook carries on.
describe('shared-cost seat: the share record', () => {
  const rows = () => ({
    participants: [{
      id: 'pS', registration_id: 'rS', email: 'seat@school.org', event_role: 'participant',
      individual_payment_status: 'pending', stripe_payment_intent_id: null, share_paid_cents: null, base_paid_cents: null,
      first_name: 'Ada', last_name: 'L', membership_id: 'M1',
    }],
    registrations: [{ id: 'rS', status: 'pending', event_title: 'Nevada 2027', share_first_paid_at: null }],
    stripe_webhook_events: [],
  })
  const event = (id: string) => ({
    id, type: 'checkout.session.completed',
    data: { object: {
      id: `cs_${id}`, payment_status: 'paid', payment_intent: `pi_${id}`,
      metadata: {
        registrationId: 'rS', participantId: 'pS', participantEmail: 'seat@home.com', isIndividualGroupPayment: 'true',
        teacherShare: 'true', baseCents: '9700', shareCents: '2425',
      },
      customer: null, customer_details: null, amount_total: 12_125, currency: 'usd',
    } },
  } as unknown as Stripe.Event)

  it('records the split on the seat', async () => {
    current = makeDb(rows())
    const res = await post(event('evt_share_ok'))
    expect(res.status).toBe(200)
    expect(await readRow('participants', 'pS')).toMatchObject({ individual_payment_status: 'paid', base_paid_cents: 9700, share_paid_cents: 2425 })
    expect(h.reportError).not.toHaveBeenCalled()
  })

  it('a share write that returns {error} is reported, and the webhook still answers 200', async () => {
    current = makeDb(rows(), { failUpdate: (t, set) => t === 'participants' && 'share_paid_cents' in set })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await post(event('evt_share_err'))

    expect(res.status).toBe(200)
    expect(h.reportError).toHaveBeenCalledTimes(1)
    const [err, opts] = h.reportError.mock.calls[0]
    expect(opts).toEqual({ route: 'POST /api/stripe/webhook' })
    expect((err as Error).message).toMatch(/registration rS, participant pS/)
    expect((err as Error).message).not.toContain('@')
    // The seat is still settled and its intent kept; the rest of the seat ran.
    expect(await readRow('participants', 'pS')).toMatchObject({ individual_payment_status: 'paid', stripe_payment_intent_id: 'pi_evt_share_err', share_paid_cents: null })
    expect(await readRow('registrations', 'rS')).toMatchObject({ status: 'confirmed' })
    expect(h.finalizeRedemption).toHaveBeenCalledTimes(1)
    // Processed: Stripe does not retry the paid seat.
    expect(current.inserts.find((i) => i.table === 'stripe_webhook_events')).toBeDefined()
    vi.mocked(console.error).mockRestore()
  })
})

// legacy-12.4: the entitlement_booking auto-refund (a failed confirm) is
// idempotent across webhook retries.
describe('entitlement_booking auto-refund is idempotent', () => {
  const bookingEvent = (id = 'evt_book') => ({
    id, type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_book', payment_status: 'paid', payment_intent: 'pi_book',
      amount_total: 12000, currency: 'usd', customer: null, customer_details: null,
      metadata: { type: 'entitlement_booking', memberId: 'm1', offeringId: 'off1', creditAppliedCents: '0' },
    } },
  } as unknown as Stripe.Event)
  const alreadyRefunded = () => Object.assign(new Error('Charge has already been refunded.'), { type: 'StripeInvalidRequestError', code: 'charge_already_refunded' })

  beforeEach(() => {
    h.confirmPaidBooking.mockRejectedValue(new Error('cohort full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    h.confirmPaidBooking.mockReset()
    h.confirmPaidBooking.mockResolvedValue('b1')
    h.finalizeRedemption.mockReset()
    h.finalizeRedemption.mockResolvedValue(undefined)
    vi.mocked(console.error).mockRestore()
    vi.mocked(console.warn).mockRestore()
  })

  it('refunds keyed on the session, tagged as ours', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    const res = await post(bookingEvent())
    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_book', metadata: expect.objectContaining({ source: 'stellr_app' }) }),
      { idempotencyKey: 'entitlement-refund-cs_book' },
    )
    expect(h.assertLiveCredentials).toHaveBeenCalledWith('stripe')
  })

  it('a redelivery of the same event does not refund again', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    await post(bookingEvent())
    const again = await post(bookingEvent())
    expect(await again.json()).toMatchObject({ duplicate: true })
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
  })

  it('a retry after a later step failed reuses the key, and charge_already_refunded counts as done', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    // First delivery: the refund goes through, then a later step fails → 500, not recorded.
    h.finalizeRedemption.mockRejectedValueOnce(new Error('redemption write failed'))
    expect((await post(bookingEvent())).status).toBe(500)
    // Stripe retries (past its 24-hour key window): the charge is already refunded.
    h.refundsCreate.mockRejectedValueOnce(alreadyRefunded())
    const retry = await post(bookingEvent())

    expect(retry.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledTimes(2)
    for (const call of h.refundsCreate.mock.calls as unknown as unknown[][]) {
      expect(call[1]).toEqual({ idempotencyKey: 'entitlement-refund-cs_book' })
    }
    expect(current.inserts.find((i) => i.table === 'stripe_webhook_events')).toBeDefined()
  })

  it('any other refund error still fails the webhook so Stripe retries', async () => {
    current = makeDb({ stripe_webhook_events: [] })
    h.refundsCreate.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { code: 'rate_limit' }))
    expect((await post(bookingEvent())).status).toBe(500)
    expect(current.inserts.find((i) => i.table === 'stripe_webhook_events')).toBeUndefined()
  })
})

describe('duplicate-payment refunds survive a late retry (legacy-12.4)', () => {
  it('charge_already_refunded on the duplicate registration refund is done: 200, no second alert', async () => {
    current = makeDb({
      registrations: [{ id: 'r1', status: 'pending', stripe_payment_intent_id: 'pi_1' }],
      participants: [],
      stripe_webhook_events: [],
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.refundsCreate.mockRejectedValueOnce(Object.assign(new Error('Charge has already been refunded.'), { code: 'charge_already_refunded' }))
    const res = await post({
      id: 'evt_dup_late', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_late', payment_status: 'paid', payment_intent: 'pi_2',
        metadata: { registrationId: 'r1' }, client_reference_id: 'r1',
        amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
      } },
    } as unknown as Stripe.Event)

    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'dup-cs_late' })
    expect(h.notifyCommunityAdmins).not.toHaveBeenCalled()
    expect(h.confirmRegistration).not.toHaveBeenCalled()
    expect(await readRow('registrations', 'r1')).toMatchObject({ stripe_payment_intent_id: 'pi_1' })
    vi.mocked(console.warn).mockRestore()
  })
})

// S5 A13a: one audit event per delivery, by webhook:stripe. The tenant comes from the
// stored registration, and BF-4's default keeps a tenant's event on Stellr's chain.
describe('platform audit (S5 A13a)', () => {
  const REG = 'cccccccc-0000-4000-8000-00000000000c'
  const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'
  const paid = (id: string) => ({
    id: `evt_${id}`, type: 'checkout.session.completed',
    data: { object: {
      id: `cs_${id}`, payment_status: 'paid', payment_intent: `pi_${id}`,
      metadata: { registrationId: REG }, client_reference_id: REG,
      amount_total: 7500, currency: 'usd', customer: null, customer_details: null,
    } },
  }) as unknown as Stripe.Event
  const withRpc = (tenant: string) => {
    current = makeDb({
      registrations: [{ id: REG, status: 'pending', stripe_payment_intent_id: null, tenant_id: tenant }],
      participants: [],
      stripe_webhook_events: [],
    })
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { id: 1, chain_seq: 1 }, error: null }))
    ;(current.db as unknown as { rpc: typeof rpc }).rpc = rpc
    return rpc
  }
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('off, nothing is written to the audit chain and the answer is the same', async () => {
    const rpc = withRpc(STELLR)
    const res = await post(paid('off'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(rpc).not.toHaveBeenCalled()
  })

  it("on, a tenant's registration payment is recorded on Stellr's chain with its owner, and the answer is the same", async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    const rpc = withRpc(TENANT_B)
    const res = await post(paid('on'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc.mock.calls[0][0]).toBe('platform_audit_append')
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_tenant: STELLR,
      p_actor: 'webhook:stripe',
      p_actor_kind: 'webhook',
      p_action: 'webhook.event.process',
      p_target_table: 'stripe_webhook_events',
      p_target_id: 'evt_on',
      p_metadata: { event_type: 'checkout.session.completed', owner_tenant_id: TENANT_B, verified: true, status: 200 },
    })
  })

  it('on, a redelivery is recorded as a duplicate', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    const rpc = withRpc(STELLR)
    current.db.from('stripe_webhook_events').insert({ id: 'evt_dup', type: 'checkout.session.completed' })
    const res = await post(paid('dup'))
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_tenant: STELLR, p_metadata: { duplicate: true, verified: true } })
  })
})
