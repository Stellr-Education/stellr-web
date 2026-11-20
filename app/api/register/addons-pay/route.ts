import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { withAudit } from '@/lib/audit/route'
import { teamAudit, ADDON_PAYMENT_START_AUDIT } from '@/lib/registration/team-audit'
import { stripeClient } from '@/lib/stripe'
import { addonPayPageUrl, loadOrderByToken } from '@/lib/addons/booking'
import { createAddonCheckout } from '@/lib/addons/checkout'

// POST /api/register/addons-pay  { token }
// Opens a Stripe Checkout for one add-on order behind its pay token (docs/PLAN-event-add-ons-2026-11-17.md,
// Phase 2). Unauthenticated by design, like /api/register/pay-seat: the token is the
// capability, and all it can do is open a Checkout whose amount the server fixes.
// Stellr's orders only; any other answers as an unknown link.
export const POST = withAudit(ADDON_PAYMENT_START_AUDIT, pay)

async function pay(req: NextRequest) {
  const { tenantId } = await requestTenant()
  const limited = await rateLimit(req, 'register/addons-pay', { limit: 20, windowMs: 10 * 60_000, tenantId })
  if (limited) return limited
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const invalid = NextResponse.json({ error: 'This link isn’t valid.' }, { status: 404 })
  const db = supabaseServer()
  const order = await loadOrderByToken(db, token)
  if (!order || tenantId !== STELLR_TENANT_ID) return invalid
  const { data: o } = await db.from('addon_orders').select('tenant_id').eq('id', order.id).maybeSingle()
  if ((o as { tenant_id: string | null } | null)?.tenant_id !== STELLR_TENANT_ID) return invalid
  if (order.registration_id) teamAudit(req, { registrationId: order.registration_id, tenantId: STELLR_TENANT_ID, userId: null })

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  const page = addonPayPageUrl(order.event_slug, token)
  const co = await createAddonCheckout(stripe, db, order, { successUrl: `${page}?paid=1`, cancelUrl: `${page}?cancelled=1` })
  if (!co.ok) return NextResponse.json({ error: co.error }, { status: co.status })
  return NextResponse.json({ url: co.url })
}
