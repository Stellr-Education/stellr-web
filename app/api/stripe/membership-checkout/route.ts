import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { ensureStripeCustomer } from '@/lib/stripe-customer'
import { assertNotImpersonating } from '@/lib/impersonation'
import { assertLiveCredentials } from '@/lib/env-guards'
import { requireStripe } from '@/lib/stripe'
import { withAudit, type AuditMutation } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { GUARANTEE_CHECKOUT_TEXT } from '@/lib/guarantee'

// Platform audit (docs/TENANCY-S5.md, C7): withAudit records every answer but a 4xx, a
// 500 after the customer was touched included. Memberships are Stellr's, so Stellr's chain;
// the member is the target, the tier and interval the detail. The Checkout Session itself
// grants nothing: the Stripe webhook grants the membership.
const auditSpec = ({ args: [req] }: { args: [Request] }): AuditMutation => {
  const { actor, target, metadata } = auditSubject(req, 'members')
  return { action: 'membership.checkout.start', actor, tenant: { stellr: true }, target, metadata }
}

export const POST = withAudit(auditSpec, async (req: Request) => {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = await req.json() as { tierId?: string; tierName?: string; billingInterval: 'monthly' | 'annual' }
  const { tierId, tierName, billingInterval } = body

  if ((!tierId && !tierName) || !billingInterval) {
    return NextResponse.json({ error: 'Missing tierId/tierName or billingInterval' }, { status: 400 })
  }

  const db = supabaseServer()

  // Get the tier and its price IDs — look up by id or by name
  const tierBase = db.from('membership_tiers').select('id, name, stripe_price_id, stripe_price_id_monthly, is_free')
  const { data: tier } = tierId
    ? await tierBase.eq('id', tierId).single()
    : await tierBase.eq('name', tierName!).single()

  if (!tier || tier.is_free) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  const priceId = billingInterval === 'monthly'
    ? tier.stripe_price_id_monthly
    : tier.stripe_price_id

  if (!priceId) {
    return NextResponse.json(
      { error: `No ${billingInterval} price configured for ${tier.name}` },
      { status: 400 }
    )
  }

  // Get the member record
  const { data: member } = await db
    .from('members')
    .select('id, email, first_name, last_name, stripe_customer_id')
    .eq('clerk_user_id', userId)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  noteAuditSubject(req, { userId, id: member.id, detail: { tier_id: tier.id, billing_interval: billingInterval === 'monthly' ? 'monthly' : 'annual' } })

  const stripe = requireStripe()
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  try {
    // Resolve a valid Stripe customer (self-heals a stale/missing stored id).
    const customerId = await ensureStripeCustomer(stripe, db, member, userId)

    // deep review PAY-15: refuse to open a subscription checkout on a production
    // deployment holding TEST keys — it would look successful and settle nothing.
    // No-op on real prod (live keys); reads above (price lookup) are not gated.
    assertLiveCredentials('stripe')

    const session = await stripe.checkout.sessions.create({
      // The money-back guarantee, on Stripe's page above the Pay button.
      custom_text: GUARANTEE_CHECKOUT_TEXT,
      customer: customerId,
      mode: 'subscription',
      // Bill in the price's currency (USD). Disables Stripe Adaptive Pricing,
      // which would otherwise present the buyer's local currency (e.g. GBP).
      adaptive_pricing: { enabled: false },
      // Stripe Tax: Checkout collects the billing address and saves it to the
      // customer so tax is computed correctly (and on renewals).
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' },
      line_items: [{ price: priceId, quantity: 1 }],
      // A field for a promotion code (e.g. MNCOSE26, the Nov 2026 MnCOSE booth
      // offer: free Catalyst).
      allow_promotion_codes: true,
      // Ask for a card only when something is due today. A 100% code then needs no card, so a free first year never renews into a
      // charge the member did not expect: with no card on file the renewal
      // invoice fails and the membership lapses instead.
      payment_method_collection: 'if_required',
      success_url: `${baseUrl}/account?membership=success`,
      cancel_url: `${baseUrl}/membership`,
      metadata: {
        type: 'membership',
        memberId: member.id,
        tierId: tier.id,
        billingInterval,
      },
      subscription_data: {
        metadata: {
          type: 'membership',
          memberId: member.id,
          tierId: tier.id,
          billingInterval,
        },
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[membership-checkout] failed:', err)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
})
