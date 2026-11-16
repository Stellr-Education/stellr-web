import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { getEventBySlug } from '@/lib/events/repo'
import { generateBadgesPdf } from '@/lib/event-pdf'
import { DEFAULT_BADGE_FORMAT, isBadgeFormat } from '@/lib/badge-layout'
import {
  effectiveBadgeTemplates,
  isBadgeOrder,
  loadBadgeHolders,
  loadBadgeTemplates,
  loadDefaultBadgeTemplates,
  resolveBadges,
} from '@/lib/event-badges'
import { artworkTheme } from '@/lib/artwork-theme'

export const dynamic = 'force-dynamic'

// S5 wave 8, C19a: tenant_crew, and Stellr-only for other tenants. Badges print on Stellr's artwork, so the
// handler asks stellrOnlyEvent right after the access check: a tenant's staff get its 503,
// another tenant's event is a 404 for everyone, a Stellr admin included, and a failed read of
// the event's owner is a retryable 503. Stellr's own events answer as before.
const ROUTE = '/api/admin/events/[slug]/badges'

// GET /api/admin/events/[slug]/badges?format=avery_5392|avery_8395[&order=school][&codes=1] — one badge
// per registered participant and per assigned volunteer mentor, on the chosen
// Avery sheet. Each badge uses its company's template, else the mentors' (for
// mentors), else everyone's — the theme default standing in for a mentors or
// everyone background the event has not uploaded — else a plain badge
// (lib/event-badges.ts). Blank
// spares follow: the rest of the last sheet and one full sheet more.
// order=school prints each school group together; codes=1 adds each person's
// check-in QR in the bottom-right corner (lib/check-in-codes.ts).
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const search = new URL(req.url).searchParams
  const requested = search.get('format')
  const format = isBadgeFormat(requested) ? requested : DEFAULT_BADGE_FORMAT
  const requestedOrder = search.get('order')
  const order = isBadgeOrder(requestedOrder) ? requestedOrder : 'surname'
  const codes = search.get('codes') === '1'

  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const [event, holders, own] = await Promise.all([
    getEventBySlug(slug),
    loadBadgeHolders(db, slug, { order, codes }),
    loadBadgeTemplates(db, slug, format),
  ])
  if (holders.length === 0) {
    return NextResponse.json({ error: 'No participants to generate badges for' }, { status: 400 })
  }
  const eventTitle = (event as { title?: string } | null)?.title ?? slug
  const theme = artworkTheme((event as { type?: string } | null)?.type ?? slug)
  const templates = effectiveBadgeTemplates(own, await loadDefaultBadgeTemplates(db, theme, format))

  const pdf = await generateBadgesPdf(await resolveBadges(db, holders, templates, { spares: format }), eventTitle, format)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-badges-${format.replace('_', '-')}.pdf"`,
    },
  })
}
