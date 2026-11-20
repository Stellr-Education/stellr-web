import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { generateBadgesPdf } from '@/lib/event-pdf'
import { designOf, loadBadgeTemplate, placementFromParams, placementOf, prepareTemplate } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// S5 wave 8, C19a: tenant_crew, and Stellr-only for other tenants. One label on Stellr's badge artwork, so the
// handler asks stellrOnlyEvent right after the access check: a tenant's staff get its 503,
// another tenant's event is a 404 for everyone, a Stellr admin included, and a failed read of
// the event's owner is a retryable 503. Stellr's own events answer as before.
const ROUTE = '/api/admin/events/[slug]/badge-templates/preview'

// GET ?id=<template>&name=&name_x=&name_y=&name_max_width=&name_size=
// One label, with a sample name, shown inline — so an admin can see where the
// name lands (and how a long one shrinks) before printing a stack. Unsaved
// slider values ride along as query params and override the stored ones.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const search = new URL(req.url).searchParams
  const name = (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield'
  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const template = await loadBadgeTemplate(db, slug, search.get('id') ?? '')
  if (!template) return NextResponse.json({ error: 'Upload the background first.' }, { status: 400 })
  const prepared = await prepareTemplate(db, template)
  if (!prepared) return NextResponse.json({ error: 'The background could not be loaded. Upload it again.' }, { status: 500 })

  const design = designOf(template, prepared, placementFromParams(placementOf(template, prepared), search))
  const [first, ...rest] = name.split(' ')
  const pdf = await generateBadgesPdf(
    [{ person: { firstName: first, lastName: rest.join(' '), subtitle: '' }, design }],
    '',
    template.format,
    { single: true },
  )
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${slug}-badge-preview.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
