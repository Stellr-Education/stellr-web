import type { Metadata } from 'next'
import Link from '@/components/ui/SiteLink'
import { supabaseServer } from '@/lib/supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { loadOrderByToken, loadOrderLines } from '@/lib/addons/booking'
import { formatAddonPrice } from '@/lib/addons/rules'
import { AddonPayButton } from './AddonPayButton'

// The pay page for event add-ons booked with "each person pays" (docs/PLAN-event-add-ons-2026-11-17.md,
// US-18, US-19). Anyone holding the link can pay, so a student can forward it to a parent.
// It shows the extras, each person's first name and the total; nothing else about anyone.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Pay for extras' }

interface PageProps {
  params: Promise<{ slug: string; token: string }>
  searchParams: Promise<{ cancelled?: string; paid?: string }>
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md rounded-ds-card bg-white p-8 text-center shadow-featured">
        <h1 className="mb-3 font-display text-2xl font-bold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export default async function AddonPayPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params
  const { cancelled, paid } = await searchParams
  const db = supabaseServer()
  const order = await loadOrderByToken(db, token)
  const { data: owner } = order ? await db.from('addon_orders').select('tenant_id').eq('id', order.id).maybeSingle() : { data: null }
  if (!order || order.event_slug !== slug || (owner as { tenant_id: string | null } | null)?.tenant_id !== STELLR_TENANT_ID) {
    return (
      <Shell title="This link isn’t valid">
        <p className="mb-6 text-content-body">We couldn’t find extras for this link. If you copied it from an email, check it’s complete, or reply to that email and we’ll help.</p>
        <Link href="/events" className="btn-primary">Browse events</Link>
      </Shell>
    )
  }
  const { data: reg } = order.registration_id
    ? await db.from('registrations').select('event_title').eq('id', order.registration_id).maybeSingle()
    : { data: null }
  const eventTitle = (reg as { event_title?: string } | null)?.event_title ?? 'Your event'

  if (order.status === 'paid' || paid === '1') {
    return (
      <Shell title="Your extras are paid for">
        <p className="mb-6 text-content-body">Thanks. A receipt is on its way by email, and the extras show in your account beside your registration.</p>
        <Link href="/events" className="btn-primary">Browse events</Link>
      </Shell>
    )
  }

  const lines = (await loadOrderLines(db, order.id)).filter((l) => l.status === 'pending_payment')
  if (order.status !== 'open' || lines.length === 0) {
    return (
      <Shell title="Nothing to pay here">
        <p className="mb-6 text-content-body">These extras have been paid, cancelled or released. Questions? Ask your group’s organizer or reply to the email that brought you here.</p>
        <Link href="/events" className="btn-primary">Browse events</Link>
      </Shell>
    )
  }
  const total = lines.reduce((n, l) => n + l.unitPriceCents * l.quantity, 0)
  const closes = lines.map((l) => l.saleClosesAt).filter((d): d is string => !!d).sort()[0]

  return (
    <div className="bg-surface flex items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-md">
        {cancelled === '1' && (
          <p role="status" className="mb-6 rounded-control border border-line bg-white px-4 py-3 text-sm text-content-body">
            Nothing was charged. Your extras are still held; pay whenever you’re ready.
          </p>
        )}
        <div className="rounded-ds-card bg-white p-8 shadow-featured">
          <p className="mb-2 font-subheading text-xs font-semibold uppercase tracking-wide text-primary">Pay for extras</p>
          <h1 className="mb-4 font-display text-2xl font-bold text-ink">{eventTitle}</h1>
          <ul className="mb-4 divide-y divide-line text-sm">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-4 py-2">
                <span className="text-content-body">
                  {l.title}
                  {l.quantity > 1 ? ` × ${l.quantity}` : ''}
                  {l.firstName ? <span className="text-content-muted"> for {l.firstName}</span> : null}
                </span>
                <span className="font-medium text-ink">{formatAddonPrice(l.unitPriceCents * l.quantity, l.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mb-6 flex justify-between border-t border-line pt-3 font-semibold text-ink">
            <span>Total</span>
            <span>{formatAddonPrice(total, order.currency)}</span>
          </p>
          {closes && (
            <p className="mb-6 text-xs text-content-muted">
              Held until {new Date(closes).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Unpaid extras are released after that.
            </p>
          )}
          <AddonPayButton token={token} />
        </div>
      </div>
    </div>
  )
}
