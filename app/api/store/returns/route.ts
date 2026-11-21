import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { currentStoreMember } from '@/lib/store/auth'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { assertLiveCredentials } from '@/lib/env-guards'
import { stripeClient } from '@/lib/stripe'
import { withAudit, type AuditMutation } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// DTC returns (PRD §12): general store merch is refundable per Printful policy;
// event/campaign batch merch is NOT (locked once committed). Members request;
// admins approve + refund.
//   POST  { orderId, reason }            — member requests a return on a DTC order
//   PATCH { returnId, action }           — admin approves (Stripe refund) or denies
//
// Platform audit (docs/TENANCY-S5.md, C7): withAudit records every answer but a 4xx, a
// 502 after a failed refund included. The store is Stellr's, so both go on Stellr's chain,
// with the signed-in user as the actor. A request names the order (its new return row's
// id is not read back); a decision names the return, which way it went, and the refund.
function storeReturnEvent(req: Request, table: string): Omit<AuditMutation, 'action'> {
  const { target, metadata } = auditSubject(req, table)
  return { actor: { session: true }, tenant: { stellr: true }, target, metadata }
}

export const POST = withAudit(({ args: [req] }: { args: [Request] }) => ({ action: 'store.return.request' as const, ...storeReturnEvent(req, 'store_orders') }), async (req: Request) => {
  const member = await currentStoreMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { orderId, reason } = body
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: order } = await db
    .from('store_orders')
    .select('id, member_id, channel, status')
    .eq('id', orderId)
    .maybeSingle()
  const o = order as { id: string; member_id: string | null; channel: string; status: string } | null
  if (!o || o.member_id !== member.id) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  // Event/campaign merch is non-refundable once the bulk order is committed.
  if (o.channel !== 'storefront') {
    return NextResponse.json({ error: 'Event merchandise is not returnable.' }, { status: 400 })
  }
  noteAuditSubject(req, { id: o.id })

  const { error } = await db.from('store_returns').insert({
    order_id: orderId,
    member_id: member.id,
    reason: reason ?? null,
    status: 'requested',
  })
  if (error) return NextResponse.json({ error: 'Could not submit return' }, { status: 500 })
  return NextResponse.json({ ok: true })
})

export const PATCH = withAudit(({ args: [req] }: { args: [Request] }) => ({ action: 'store.return.decide' as const, ...storeReturnEvent(req, 'store_returns') }), async (req: Request) => {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { returnId, action } = body
  if (!returnId || (action !== 'approve' && action !== 'deny')) {
    return NextResponse.json({ error: "returnId and action (approve|deny) required" }, { status: 400 })
  }

  const db = supabaseServer()
  const { data: ret } = await db.from('store_returns').select('id, order_id, status').eq('id', returnId).maybeSingle()
  const r = ret as { id: string; order_id: string; status: string } | null
  if (!r) return NextResponse.json({ error: 'Return not found' }, { status: 404 })
  noteAuditSubject(req, { id: r.id, detail: { decision: action, order_id: r.order_id } })

  if (action === 'deny') {
    await db.from('store_returns').update({ status: 'denied' }).eq('id', returnId)
    return NextResponse.json({ ok: true })
  }

  // Approve → refund the order's payment intent via Stripe.
  const { data: order } = await db.from('store_orders').select('stripe_payment_intent_id').eq('id', r.order_id).maybeSingle()
  const pi = (order as { stripe_payment_intent_id?: string | null } | null)?.stripe_payment_intent_id
  const stripe = stripeClient()
  let refundId: string | null = null
  if (stripe && pi) {
    try {
      // deep review PAY-15: refuse to "refund" on a production deployment holding
      // TEST keys — a test-mode refund settles nothing. No-op on real prod.
      assertLiveCredentials('stripe')
      const refund = await stripe.refunds.create({ payment_intent: pi })
      refundId = refund.id
      noteAuditSubject(req, { detail: { refund_id: refund.id } })
    } catch (err) {
      return NextResponse.json({ error: `Refund failed: ${(err as Error).message}` }, { status: 502 })
    }
  }
  await db.from('store_returns').update({ status: 'refunded', stripe_refund_id: refundId }).eq('id', returnId)
  await db.from('store_orders').update({ status: 'refunded' }).eq('id', r.order_id)
  return NextResponse.json({ ok: true, refundId })
})
