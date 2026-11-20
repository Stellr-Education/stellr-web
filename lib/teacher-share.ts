import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/events/repo'
import { isAdultRole, isSharedGroup, payerOf, type PayerGroup } from '@/lib/group-payer'
import type { CouponTerms } from '@/lib/group-billing'
import { checkoutInvoiceParams } from '@/lib/payments/checkout-invoice'
import type { ParticipantRow, RegistrationRow } from '@/lib/database.types'
import { loadRegistrationTenantId } from '@/lib/tenancy/registration-tenant'

// Students share the teacher's cost (9 Nov 2026). Owner decisions, recorded in
// docs/PLAN-group-payment-options-2026-11-09.md:
//
//   - Teachers pay full price; no code ever discounts it. Their place is
//     'covered' and they pay nothing directly.
//   - Each student's link carries an equal share: the teachers' full price over
//     the larger of the teacher's estimate and the students carrying a share.
//     Codes apply to the student's own place only.
//   - Once a student has paid, the share can only go down: adding a student
//     lowers it, removing one leaves it. Before that it simply follows the
//     group (an adult added then folds in and the share rises once).
//   - The day after the event the share is settled: anyone who paid more than
//     the final share gets the difference back, once. What isn't collected
//     (fewer students than estimated, withdrawals) Stellr absorbs.
//   - Every student paying by link carries a share, scholarship or not. A
//     student who had paid before the group switched isn't charged or counted.
//   - Leaving this option refunds every share already paid.
//
// Rounding is down to the cent, so the shares never add up to more than the
// teachers' cost.

type Db = SupabaseClient

export const STRIPE_MIN_CHARGE_CENTS = 50

// ── Pure rules ───────────────────────────────────────────────────────────────

export interface ShareInputs {
  /** The teachers' full price in total. */
  poolCents: number
  estimate: number
  /** Students carrying a share right now. */
  students: number
}

/** The share before the "only goes down" rule: the pool over the larger of the estimate and the students. */
export function shareFor(i: ShareInputs): number {
  if (i.poolCents <= 0) return 0
  return Math.floor(i.poolCents / Math.max(1, i.estimate, i.students))
}

/** The live share: follows the group until the first payment, then only goes down. */
export function nextShare(i: ShareInputs & { previous: number | null; firstPaid: boolean }): number {
  const computed = shareFor(i)
  if (!i.firstPaid || i.previous == null) return computed
  return Math.min(i.previous, computed)
}

/** What one student pays: their own place after any code, plus the share. */
export interface SeatCharge {
  listCents: number
  discountCents: number
  baseCents: number
  shareCents: number
  totalCents: number
  /** The share is below Stripe's minimum on a place that is otherwise free: it isn't charged. */
  shareWaived: boolean
}

export function seatCharge(listCents: number, coupon: CouponTerms | null, shareCents: number): SeatCharge {
  let discount = 0
  if (coupon?.percentOff) discount = Math.round((listCents * coupon.percentOff) / 100)
  else if (coupon?.amountOffCents) discount = Math.min(listCents, coupon.amountOffCents)
  const base = listCents - discount
  // A full scholarship still carries the share, unless that's too small to charge.
  const shareWaived = base === 0 && shareCents > 0 && shareCents < STRIPE_MIN_CHARGE_CENTS
  const share = shareWaived ? 0 : shareCents
  return { listCents, discountCents: discount, baseCents: base, shareCents: share, totalCents: base + share, shareWaived }
}

/** The refund owed at settlement: what was paid toward the share above the final share. */
export function trueUpCents(paidShareCents: number | null, finalShareCents: number): number {
  return Math.max(0, (paidShareCents ?? 0) - finalShareCents)
}

export interface ShareGroup extends PayerGroup {
  id: string
  event_slug: string
  share_estimate: number | null
  share_unit_cents: number | null
  share_cents: number | null
  share_first_paid_at: string | null
  share_settled_at: string | null
}

export interface SharePerson {
  id: string
  payer: string | null
  individual_payment_status: string | null
  event_role: string | null
  share_paid_cents: number | null
  stripe_payment_intent_id?: string | null
  member_id?: string | null
}

/** Paid before the group started sharing the teacher's cost: not charged, not counted. */
const paidBeforeSharing = (p: SharePerson) => p.individual_payment_status === 'paid' && p.share_paid_cents == null

/** Who is in the pool and who carries a share, from the roster. */
export function shareCounts(reg: ShareGroup, people: SharePerson[]): { sharedAdults: number; students: number; poolCents: number } {
  const sharedAdults = people.filter((p) => payerOf(p, reg) === 'shared').length
  const students = people.filter((p) => !isAdultRole(p.event_role) && payerOf(p, reg) === 'self' && !paidBeforeSharing(p)).length
  return { sharedAdults, students, poolCents: sharedAdults * (reg.share_unit_cents ?? 0) }
}

export interface ShareSummary {
  estimate: number
  shareCents: number
  poolCents: number
  sharedAdults: number
  students: number
  /** Shares paid so far. */
  collectedCents: number
  /** What the pool would still be short if nobody else paid: Stellr absorbs it. */
  projectedShortfallCents: number
  firstPaid: boolean
  settled: boolean
}

export function summarise(reg: ShareGroup, people: SharePerson[]): ShareSummary {
  const counts = shareCounts(reg, people)
  const share = reg.share_cents ?? shareFor({ poolCents: counts.poolCents, estimate: reg.share_estimate ?? 1, students: counts.students })
  const collected = people.reduce((sum, p) => sum + (p.share_paid_cents ?? 0), 0)
  return {
    estimate: reg.share_estimate ?? 0,
    shareCents: share,
    poolCents: counts.poolCents,
    sharedAdults: counts.sharedAdults,
    students: counts.students,
    collectedCents: collected,
    projectedShortfallCents: Math.max(0, counts.poolCents - share * counts.students),
    firstPaid: !!reg.share_first_paid_at,
    settled: !!reg.share_settled_at,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

const SHARE_REG_COLUMNS = 'id, event_slug, event_title, member_pays_individually, late_joiner_payer, share_estimate, share_unit_cents, share_cents, share_first_paid_at, share_settled_at'
const SHARE_PEOPLE_COLUMNS = 'id, payer, individual_payment_status, event_role, share_paid_cents, stripe_payment_intent_id, member_id'

// group-payment-options.12: the rows these reads return, from the schema in
// lib/database.types.ts (participants.member_id isn't in that hand-written file yet).
type ShareRegRow = Pick<RegistrationRow,
  'id' | 'event_slug' | 'event_title' | 'member_pays_individually' | 'late_joiner_payer'
  | 'share_estimate' | 'share_unit_cents' | 'share_cents' | 'share_first_paid_at' | 'share_settled_at'>
type SharePersonRow = Pick<ParticipantRow,
  'id' | 'payer' | 'individual_payment_status' | 'event_role' | 'share_paid_cents' | 'stripe_payment_intent_id'>
  & { member_id: string | null }

export async function loadShareGroup(db: Db, registrationId: string): Promise<{ reg: ShareGroup & { event_title?: string }; people: SharePerson[] } | null> {
  const { data: reg } = await db.from('registrations').select(SHARE_REG_COLUMNS).eq('id', registrationId).maybeSingle<ShareRegRow>()
  if (!reg) return null
  const { data, error } = await db.from('participants').select(SHARE_PEOPLE_COLUMNS).eq('registration_id', registrationId)
  if (error) throw new Error(`Could not read the group: ${error.message}`)
  const people: SharePersonRow[] = data ?? []
  return { reg, people }
}

// ── Keeping the share current ────────────────────────────────────────────────

/**
 * Brings a sharing group's share in line with its roster, and marks any adult who
 * has just folded into the pool as covered. Called after every roster change and
 * before every checkout; settled groups keep their final share. Null for a group
 * that doesn't share the teacher's cost.
 */
export async function refreshShare(db: Db, registrationId: string): Promise<ShareSummary | null> {
  const loaded = await loadShareGroup(db, registrationId)
  if (!loaded || !isSharedGroup(loaded.reg)) return null
  return refreshLoaded(db, loaded)
}

type LoadedShareGroup = NonNullable<Awaited<ReturnType<typeof loadShareGroup>>>

/** refreshShare on a group already read; updates `loaded` in place as it writes. */
async function refreshLoaded(db: Db, loaded: LoadedShareGroup): Promise<ShareSummary> {
  const { reg, people } = loaded
  const registrationId = reg.id

  // An adult who joined with no payer recorded and folds into the pool.
  const folding = people.filter((p) => p.payer == null && p.individual_payment_status == null && payerOf(p, reg) === 'shared')
  if (folding.length > 0) {
    const { error } = await db.from('participants')
      .update({ payer: 'shared', individual_payment_status: 'covered' })
      .in('id', folding.map((p) => p.id))
    if (error) console.error('[teacher-share] could not cover a new adult:', error.message, { registrationId })
    else folding.forEach((p) => { p.payer = 'shared'; p.individual_payment_status = 'covered' })
  }

  if (reg.share_settled_at) return summarise(reg, people)
  const counts = shareCounts(reg, people)
  const next = nextShare({
    poolCents: counts.poolCents,
    estimate: reg.share_estimate ?? 1,
    students: counts.students,
    previous: reg.share_cents,
    firstPaid: !!reg.share_first_paid_at,
  })
  if (next !== reg.share_cents) {
    let write = db.from('registrations').update({ share_cents: next }).eq('id', reg.id)
    write = reg.share_cents == null ? write.is('share_cents', null) : write.eq('share_cents', reg.share_cents)
    const { error } = await write
    if (error) console.error('[teacher-share] share update failed:', error.message, { registrationId })
    else reg.share_cents = next
  }
  return summarise(reg, people)
}

// ── Refunds of shares ────────────────────────────────────────────────────────

interface ShareRefund { participantId: string; cents: number; refundId: string | null; error: string | null }

const isAlreadyRefunded = (e: unknown) => (e as { code?: unknown } | null)?.code === 'charge_already_refunded'

async function refundShare(
  db: Db,
  stripe: Stripe,
  reg: ShareGroup,
  p: SharePerson,
  cents: number,
  kind: 'share_true_up' | 'share_unwind',
): Promise<ShareRefund> {
  if (cents <= 0) return { participantId: p.id, cents: 0, refundId: null, error: null }
  // S5 wave 8: the registration's tenant, explicit beside event_slug (Lane C optional-event writers).
  const tenantId = await loadRegistrationTenantId(db, reg.id)
  const row = { tenant_id: tenantId, participant_id: p.id, registration_id: reg.id, member_id: p.member_id ?? null, event_slug: reg.event_slug, paid_cents: p.share_paid_cents, kind }
  if (!p.stripe_payment_intent_id) {
    const error = 'no payment recorded to refund against'
    await db.from('event_refunds').insert({ ...row, refund_type: 'manual_required', refund_cents: cents })
    return { participantId: p.id, cents, refundId: null, error }
  }
  // One true-up per person, and one unwind per share paid: a retry is a no-op at Stripe.
  const idempotencyKey = `${kind}-${p.id}-${p.share_paid_cents ?? 0}`
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: p.stripe_payment_intent_id, amount: cents, metadata: { source: 'stellr_app', participant_id: p.id, kind } },
      { idempotencyKey },
    )
    await db.from('event_refunds').insert({ ...row, refund_type: 'cash', refund_cents: cents, stripe_refund_id: refund.id })
    await db.from('participants').update({ share_paid_cents: (p.share_paid_cents ?? 0) - cents }).eq('id', p.id)
    return { participantId: p.id, cents, refundId: refund.id, error: null }
  } catch (e) {
    if (isAlreadyRefunded(e)) return alreadyRefunded(db, stripe, p, cents, kind, row, idempotencyKey)
    const error = e instanceof Error ? e.message : String(e)
    console.error('[teacher-share] refund failed:', error, { participantId: p.id, kind })
    await db.from('event_refunds').insert({ ...row, refund_type: 'manual_required', refund_cents: cents })
    return { participantId: p.id, cents, refundId: null, error }
  }
}

/**
 * backlog-batch2.2 (the refundShare guard, as #715 did for the webhook's
 * refunds): Stripe answers charge_already_refunded when the whole charge is
 * already back with the payer, typically a retry after the idempotency key's
 * 24-hour window when an earlier attempt's refund went through but a write after
 * it didn't, or a full refund made elsewhere. The money is back, so this is done,
 * not a failure: no manual_required row and no staff alert. The refunds log says
 * how it got there: our own earlier refund (found by its metadata) is logged as
 * cash once; a refund we didn't make is logged as 'none' for 0, so the log never
 * counts the same money twice. The share is then cleared down by `cents`, so a
 * re-run has nothing left to refund.
 */
async function alreadyRefunded(
  db: Db,
  stripe: Stripe,
  p: SharePerson,
  cents: number,
  kind: 'share_true_up' | 'share_unwind',
  row: Record<string, unknown>,
  idempotencyKey: string,
): Promise<ShareRefund> {
  const intent = p.stripe_payment_intent_id as string
  console.warn('[teacher-share] charge already refunded; treating the share refund as done:', { participantId: p.id, kind, idempotencyKey })
  let ours: { id: string; amount: number } | null = null
  try {
    const refunds = await stripe.refunds.list({ payment_intent: intent, limit: 100 })
    const found = refunds.data.find((r) => r.metadata?.participant_id === p.id && r.metadata?.kind === kind && r.status !== 'failed' && r.status !== 'canceled')
    if (found) ours = { id: found.id, amount: found.amount }
  } catch (e) {
    console.error('[teacher-share] could not list the refunds on an already-refunded charge:', e instanceof Error ? e.message : e, { participantId: p.id, kind })
  }
  if (ours) {
    const { data: logged } = await db.from('event_refunds').select('id').eq('stripe_refund_id', ours.id).limit(1)
    if (!logged || logged.length === 0) {
      await db.from('event_refunds').insert({ ...row, refund_type: 'cash', refund_cents: ours.amount, stripe_refund_id: ours.id })
    }
  } else {
    await db.from('event_refunds').insert({ ...row, refund_type: 'none', refund_cents: 0 })
  }
  await db.from('participants').update({ share_paid_cents: Math.max(0, (p.share_paid_cents ?? 0) - cents) }).eq('id', p.id)
  return { participantId: p.id, cents, refundId: ours?.id ?? null, error: null }
}

/**
 * group-payment-options.10 fallback: a student who paid through a shared-cost
 * checkout but whose share_paid_cents is NULL (the webhook's write failed) would
 * otherwise be counted as "paid before sharing": left out of the share and never
 * trued up. Their Checkout session still carries the split recordSeatShare reads,
 * so look it up by their payment intent and use it. The recovered split is
 * written back (best effort) so later reads agree; settlement uses it either way.
 * A student whose session isn't a shared-cost one really did pay before sharing.
 *
 * backlog-batch2.2 (unwindShares): a student whose split can't be worked out
 * either way (no payment intent, no session found for it, a shared-cost session
 * for someone else, or Stripe not answering) is returned as unresolved, never
 * silently skipped; the caller reports them to app_errors for a person to check.
 * A session that isn't a shared-cost one is never reported, whatever its
 * participantId says (pre-PAY-7 per-seat sessions have none).
 */
interface UnresolvedShare { participantId: string; reason: string }

async function recoverUnrecordedShares(db: Db, stripe: Stripe, loaded: LoadedShareGroup): Promise<{ recovered: number; unresolved: UnresolvedShare[] }> {
  const { reg, people } = loaded
  const candidates = people.filter((p) => paidBeforeSharing(p) && !isAdultRole(p.event_role) && payerOf(p, reg) === 'self')
  let recovered = 0
  const unresolved: UnresolvedShare[] = []
  for (const p of candidates) {
    const intent = p.stripe_payment_intent_id
    if (!intent) { unresolved.push({ participantId: p.id, reason: 'no payment intent recorded' }); continue }
    let split: ReturnType<typeof seatSplitFromMetadata> = null
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: intent, limit: 1 })
      const session = sessions.data[0]
      if (!session) { unresolved.push({ participantId: p.id, reason: 'no checkout session for the payment' }); continue }
      split = seatSplitFromMetadata(session.metadata)
      // Not a shared-cost session: they really paid before sharing, and owe no
      // share. Checked before the participant match, because per-seat sessions
      // from before PAY-7 (#390) carry no participantId at all.
      if (!split) continue
      if (session.metadata?.participantId !== p.id) { unresolved.push({ participantId: p.id, reason: 'checkout session is for another participant' }); continue }
    } catch (e) {
      console.error('[teacher-share] could not read the checkout session for an unrecorded share:', e instanceof Error ? e.message : e, { registrationId: reg.id, participantId: p.id })
      unresolved.push({ participantId: p.id, reason: 'checkout session lookup failed' })
      continue
    }
    if (!split) continue
    p.share_paid_cents = split.shareCents
    recovered++
    const { error } = await db.from('participants')
      .update({ base_paid_cents: split.baseCents, share_paid_cents: split.shareCents, discount_code: split.discountCode })
      .eq('id', p.id).is('share_paid_cents', null)
    if (error) console.error('[teacher-share] could not write back a recovered share:', error.message, { registrationId: reg.id, participantId: p.id })
  }
  // The same failed webhook may have missed the first-paid stamp, which starts
  // the "only goes down" rule.
  if (!reg.share_first_paid_at && candidates.some((p) => (p.share_paid_cents ?? 0) > 0)) {
    const stamp = new Date().toISOString()
    reg.share_first_paid_at = stamp
    const { error } = await db.from('registrations').update({ share_first_paid_at: stamp }).eq('id', reg.id).is('share_first_paid_at', null)
    if (error) console.error('[teacher-share] could not stamp the first share paid:', error.message, { registrationId: reg.id })
  }
  return { recovered, unresolved }
}

/** Unresolved shares go to app_errors (the staff digest), with ids only. */
async function reportUnresolvedShares(registrationId: string, unresolved: UnresolvedShare[], where: 'settleShare' | 'unwindShares') {
  if (unresolved.length === 0) return
  // Lazy, like recordSeatShare: app-errors reaches the email stack, which the pure tests never load.
  const { reportError } = await import('@/lib/app-errors')
  for (const u of unresolved) {
    console.error('[teacher-share] share could not be worked out; reported for follow-up', { registrationId, participantId: u.participantId, reason: u.reason, where })
    await reportError(
      new Error(`Shared-cost share unknown for registration ${registrationId}, participant ${u.participantId} (${u.reason}): check what they paid toward the share and refund it by hand if owed`),
      { route: `lib/teacher-share ${where}` },
    )
  }
}

async function alertTeam(body: string) {
  // Lazy, through the billing helper: it reaches Clerk, which the pure tests never load.
  const { alertTeam: alert } = await import('@/lib/group-billing')
  await alert(body)
}

/**
 * Settles one group's share: everyone who paid more than the final share gets the
 * difference back, then the share is frozen. Safe to re-run: a person already
 * trued up has nothing left above the final share.
 */
export async function settleShare(db: Db, stripe: Stripe, registrationId: string): Promise<{ refunded: number; failed: number } | null> {
  const loaded = await loadShareGroup(db, registrationId)
  if (!loaded || !isSharedGroup(loaded.reg) || loaded.reg.share_settled_at) return null
  // Before counting: a student whose share the webhook couldn't record is not
  // "paid before sharing". Their split is on their Checkout session.
  const { unresolved } = await recoverUnrecordedShares(db, stripe, loaded)
  await reportUnresolvedShares(registrationId, unresolved, 'settleShare')
  const summary = await refreshLoaded(db, loaded)
  if (summary.settled) return null
  const final = summary.shareCents
  const results: ShareRefund[] = []
  for (const p of loaded.people) {
    const owed = trueUpCents(p.share_paid_cents, final)
    if (owed > 0) results.push(await refundShare(db, stripe, loaded.reg, p, owed, 'share_true_up'))
  }
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    await alertTeam(`Settling the teacher's cost for the ${loaded.reg.event_title ?? loaded.reg.event_slug} group: ${failed.length} refund${failed.length === 1 ? '' : 's'} couldn't be made (${failed[0].error}). Refund them in Stripe; they're recorded as manual in the refunds log.`)
  }
  await db.from('registrations').update({ share_settled_at: new Date().toISOString() }).eq('id', registrationId).is('share_settled_at', null)
  return { refunded: results.filter((r) => !r.error).length, failed: failed.length }
}

/** True once the day after the event has begun (event end date, else its date). */
export function eventIsOver(event: { date?: string | null; endDate?: string | null } | null, now = new Date()): boolean {
  const last = event?.endDate ?? event?.date
  if (!last) return false
  const dayAfter = new Date(`${last.slice(0, 10)}T00:00:00Z`)
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
  return now.getTime() >= dayAfter.getTime()
}

/** The daily sweep: settles every sharing group whose event is over. */
export async function settleDueShares(db: Db, stripe: Stripe, limit = 50): Promise<Record<string, number>> {
  const { data, error } = await db.from('registrations')
    .select('id, event_slug')
    .not('share_estimate', 'is', null)
    .is('share_settled_at', null)
    .neq('status', 'withdrawn')
    .limit(limit)
  if (error) throw new Error(error.message)
  const tally: Record<string, number> = { settled: 0, not_due: 0, refunds: 0, refunds_failed: 0 }
  const events = new Map<string, boolean>()
  const due: Pick<RegistrationRow, 'id' | 'event_slug'>[] = data ?? []
  for (const row of due) {
    if (!events.has(row.event_slug)) {
      const event = (await getEventBySlug(row.event_slug).catch(() => null)) as { date?: string; endDate?: string } | null
      events.set(row.event_slug, eventIsOver(event))
    }
    if (!events.get(row.event_slug)) { tally.not_due++; continue }
    const out = await settleShare(db, stripe, row.id)
    if (!out) continue
    tally.settled++
    tally.refunds += out.refunded
    tally.refunds_failed += out.failed
  }
  return tally
}

/**
 * The group stops sharing the teacher's cost: every share paid is refunded, the
 * covered adults are no longer covered, and the share columns are cleared. The
 * caller then starts whatever the group pays by next. Returns how many refunds
 * failed (staff are alerted).
 */
export async function unwindShares(db: Db, stripe: Stripe, registrationId: string): Promise<{ refunded: number; failed: number }> {
  const loaded = await loadShareGroup(db, registrationId)
  if (!loaded) return { refunded: 0, failed: 0 }
  // backlog-batch2.2: as settlement does (#715), a student whose share the webhook
  // couldn't record (NULL) gets their split from their Checkout session, so their
  // share is refunded too; one that can't be worked out is reported, not skipped.
  const { unresolved } = await recoverUnrecordedShares(db, stripe, loaded)
  await reportUnresolvedShares(registrationId, unresolved, 'unwindShares')
  const results: ShareRefund[] = []
  for (const p of loaded.people) {
    if ((p.share_paid_cents ?? 0) > 0) results.push(await refundShare(db, stripe, loaded.reg, p, p.share_paid_cents as number, 'share_unwind'))
  }
  const covered = loaded.people.filter((p) => p.individual_payment_status === 'covered' || p.payer === 'shared').map((p) => p.id)
  if (covered.length > 0) {
    await db.from('participants').update({ payer: null, individual_payment_status: null, individual_payment_link_sent_at: null }).in('id', covered)
  }
  await db.from('registrations').update({
    share_estimate: null, share_unit_cents: null, share_cents: null, share_first_paid_at: null, share_settled_at: null,
  }).eq('id', registrationId)
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    await alertTeam(`The ${loaded.reg.event_title ?? loaded.reg.event_slug} group stopped sharing the teacher's cost, but ${failed.length} share refund${failed.length === 1 ? '' : 's'} couldn't be made (${failed[0].error}). Refund them in Stripe; they're recorded as manual in the refunds log.`)
  }
  return { refunded: results.length - failed.length, failed: failed.length }
}

// ── A student's checkout ─────────────────────────────────────────────────────
//
// Stripe applies a promotion code to the whole session, and the codes in use
// (STEMCAREERS, SCHOLARSHIP*) aren't limited to a product, so a code entered on
// Stripe's page would discount the teacher's share too. For a sharing group the
// pay page takes the code itself; the server checks it and prices the place, and
// Checkout gets two plain lines: the place (after the code) and the share. The
// code goes in the session's metadata and onto the participant when paid.
// Trade-off: Stripe's own redemption count for the code doesn't move.

export interface SharedSeatCheckoutOptions {
  participantId: string
  participantEmail: string
  registrationId: string
  eventSlug: string
  eventTitle: string
  /** Whose place this is, for the invoice description. */
  participantName?: string | null
  successUrl: string
  cancelUrl: string
  /** What the student typed, if anything. */
  discountCode?: string | null
  /** A percentage discount an admin set on the group, applied to the place. */
  groupCouponId?: string | null
}

export type SharedSeatCheckoutResult =
  | { url: string; sessionId: string; charge: SeatCharge }
  | { error: 'no_price' | 'bad_code' | 'too_small'; message: string }
  | { waived: true; charge: SeatCharge }

/** The event's list price, its currency and product, from its Stripe Price. */
async function listPrice(stripe: Stripe, eventSlug: string): Promise<{ unitCents: number; currency: string; productId: string | null } | null> {
  const event = (await getEventBySlug(eventSlug).catch(() => null)) as { stripePriceId?: string } | null
  if (!event?.stripePriceId) return null
  const price = await stripe.prices.retrieve(event.stripePriceId)
  if ((price.unit_amount ?? 0) <= 0) return null
  return {
    unitCents: price.unit_amount as number,
    currency: price.currency ?? 'usd',
    productId: typeof price.product === 'string' ? price.product : price.product?.id ?? null,
  }
}

/** The terms of the code the student typed, or why it can't be used here. */
async function placeDiscount(
  stripe: Stripe,
  code: string | null | undefined,
  groupCouponId: string | null | undefined,
  productId: string | null,
): Promise<{ terms: CouponTerms | null; code: string | null } | { error: string }> {
  if (code?.trim()) {
    const { resolveDiscountCode } = await import('@/lib/group-billing')
    // A code a student types: a promotion code, never a bare coupon id (lib/group-billing).
    const resolved = await resolveDiscountCode(stripe, code, { promotionCodesOnly: true }).catch(() => null)
    if (!resolved) return { error: 'That code isn’t valid. Check it and try again, or pay without one.' }
    const coupon = await stripe.coupons.retrieve(resolved.couponId, { expand: ['applies_to'] }).catch(() => null)
    const limited = coupon?.applies_to?.products ?? []
    if (limited.length > 0 && (!productId || !limited.includes(productId))) {
      return { error: 'That code doesn’t apply to this event.' }
    }
    return { terms: resolved.terms, code: resolved.code }
  }
  if (groupCouponId) {
    const coupon = await stripe.coupons.retrieve(groupCouponId).catch(() => null)
    if (coupon?.valid && coupon.percent_off) return { terms: { percentOff: coupon.percent_off, amountOffCents: null }, code: null }
  }
  return { terms: null, code: null }
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/**
 * One student's checkout in a group that shares the teacher's cost. A place that
 * comes to nothing (a full scholarship whose share is too small to charge) is
 * marked settled instead of opening a $0 checkout.
 */
export async function createSharedSeatCheckout(db: Db, stripe: Stripe, opts: SharedSeatCheckoutOptions): Promise<SharedSeatCheckoutResult> {
  const price = await listPrice(stripe, opts.eventSlug)
  if (!price) return { error: 'no_price', message: 'This event’s fee is misconfigured — please contact Stellr.' }
  const summary = await refreshShare(db, opts.registrationId)
  const share = summary?.shareCents ?? 0
  const discount = await placeDiscount(stripe, opts.discountCode, opts.groupCouponId, price.productId)
  if ('error' in discount) return { error: 'bad_code', message: discount.error }
  const charge = seatCharge(price.unitCents, discount.terms, share)

  if (charge.totalCents === 0) {
    await db.from('participants').update({
      individual_payment_status: 'waived', base_paid_cents: 0, share_paid_cents: 0, discount_code: discount.code,
    }).eq('id', opts.participantId).eq('individual_payment_status', 'pending')
    return { waived: true, charge }
  }
  if (charge.totalCents < STRIPE_MIN_CHARGE_CENTS) {
    return { error: 'too_small', message: `The amount due (${money(charge.totalCents, price.currency)}) is below the $0.50 card minimum. Please contact Stellr.` }
  }

  const { assertLiveCredentials } = await import('@/lib/env-guards')
  assertLiveCredentials('stripe')
  const { GUARANTEE_CHECKOUT_TEXT } = await import('@/lib/guarantee')
  const lines: Stripe.Checkout.SessionCreateParams.LineItem[] = []
  if (charge.baseCents > 0) {
    lines.push({
      quantity: 1,
      price_data: {
        currency: price.currency,
        unit_amount: charge.baseCents,
        product_data: {
          name: `${opts.eventTitle} — your place`,
          ...(charge.discountCents > 0 ? { description: `${money(charge.listCents, price.currency)} less ${discount.code ?? 'the group discount'} (${money(charge.discountCents, price.currency)})` } : {}),
        },
      },
    })
  }
  if (charge.shareCents > 0) {
    lines.push({
      quantity: 1,
      price_data: {
        currency: price.currency,
        unit_amount: charge.shareCents,
        product_data: {
          name: 'Your share of the teacher’s cost',
          description: 'Split evenly across the group’s students. It can only go down: if more students join, the difference comes back after the event.',
        },
      },
    })
  }
  // A paid invoice and an emailed receipt for the place (lib/payments/checkout-invoice.ts).
  const invoiceParams = checkoutInvoiceParams({
    registrationId: opts.registrationId,
    eventSlug: opts.eventSlug,
    eventTitle: opts.eventTitle,
    participantId: opts.participantId,
    forName: opts.participantName ?? null,
  })
  const session = await stripe.checkout.sessions.create({
    custom_text: GUARANTEE_CHECKOUT_TEXT,
    mode: 'payment',
    line_items: lines,
    customer_creation: 'always',
    client_reference_id: opts.registrationId,
    metadata: {
      registrationId: opts.registrationId,
      eventSlug: opts.eventSlug,
      participantId: opts.participantId,
      participantEmail: opts.participantEmail,
      isIndividualGroupPayment: 'true',
      teacherShare: 'true',
      baseCents: String(charge.baseCents),
      shareCents: String(charge.shareCents),
      ...(discount.code ? { discountCode: discount.code } : {}),
    },
    ...invoiceParams,
    payment_intent_data: {
      ...invoiceParams.payment_intent_data,
      metadata: { registrationId: opts.registrationId, participantId: opts.participantId, teacherShare: 'true' },
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  })
  if (!session.url) throw new Error('Stripe returned no checkout URL')
  return { url: session.url, sessionId: session.id, charge }
}

/** The split a shared-cost Checkout session carries in its metadata, or null when it isn't one. */
export function seatSplitFromMetadata(
  metadata: Record<string, string> | null | undefined,
): { baseCents: number; shareCents: number; discountCode: string | null } | null {
  if (metadata?.teacherShare !== 'true') return null
  const base = Number(metadata.baseCents)
  const share = Number(metadata.shareCents)
  if (metadata.baseCents == null || metadata.shareCents == null || !Number.isFinite(base) || !Number.isFinite(share)) return null
  return { baseCents: base, shareCents: share, discountCode: metadata.discountCode ?? null }
}

export type SeatShareResult =
  | { status: 'skipped' }
  | { status: 'recorded' }
  | { status: 'failed'; error: string }

/**
 * The webhook's half: what a student paid toward their place and the share,
 * read from the session (never the live share, which may have dropped since).
 * The first share paid starts the "only goes down" rule. Never throws.
 *
 * group-payment-options.10: a write that comes back with a Supabase `{ error }`
 * used to pass silently, leaving share_paid_cents NULL, so settlement counted the
 * student as "paid before sharing" and never trued them up. A failure is now
 * reported to app_errors (the staff digest) with the registration and participant
 * ids only, and returned so the webhook can note it. The payment itself
 * succeeded, so the webhook still answers 200; settleShare recovers the split
 * from the Checkout session.
 */
export async function recordSeatShare(
  db: Db,
  registrationId: string,
  participantId: string | null | undefined,
  metadata: Record<string, string> | null | undefined,
): Promise<SeatShareResult> {
  if (!participantId) return { status: 'skipped' }
  const split = seatSplitFromMetadata(metadata)
  if (!split) return { status: 'skipped' }
  const failures: string[] = []
  try {
    const { error } = await db.from('participants')
      .update({ base_paid_cents: split.baseCents, share_paid_cents: split.shareCents, discount_code: split.discountCode })
      .eq('id', participantId)
    if (error) failures.push(`participant write: ${error.code ?? error.message ?? 'unknown'}`)
  } catch (e) {
    failures.push(`participant write threw: ${e instanceof Error ? e.name : 'unknown'}`)
  }
  if (split.shareCents > 0) {
    try {
      const { error } = await db.from('registrations').update({ share_first_paid_at: new Date().toISOString() })
        .eq('id', registrationId).is('share_first_paid_at', null)
      if (error) failures.push(`first-paid write: ${error.code ?? error.message ?? 'unknown'}`)
    } catch (e) {
      failures.push(`first-paid write threw: ${e instanceof Error ? e.name : 'unknown'}`)
    }
  }
  if (failures.length === 0) return { status: 'recorded' }

  const error = failures.join('; ')
  console.error('[teacher-share] could not record a share payment:', error, { registrationId, participantId })
  // Lazy, like alertTeam: app-errors reaches the email stack, which the pure tests never load.
  const { reportError } = await import('@/lib/app-errors')
  await reportError(
    new Error(`Shared-cost share not recorded for registration ${registrationId}, participant ${participantId} (${error})`),
    { route: 'POST /api/stripe/webhook' },
  )
  return { status: 'failed', error }
}
