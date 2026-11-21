import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventRoute } from '@/lib/authz'
import { BADGE_FORMATS, isBadgeFormat, placementFromLine, type BadgeAudience } from '@/lib/badge-layout'
import { eventArtworkTheme } from '@/lib/artwork-defaults'
import { BADGE_PLACEMENT_RANGES, badgePlacementFromArtwork, claimArtwork, placementInput } from '@/lib/artwork-template-input'
import {
  fillPlacements,
  loadBadgeTemplate,
  loadBadgeTemplates,
  loadCompanies,
  loadDefaultBadgeTemplates,
  prepareTemplate,
} from '@/lib/event-badges'
import { bodyIds, withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { stellrOnlyDb } from '@/lib/events/admin-records'
import { deleteEventBadgeTemplate, eventHasCompany, findEventBadgeTemplateId, saveEventBadgeTemplate } from '@/lib/events/admin-artwork'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'

export const dynamic = 'force-dynamic'

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventRoute and
// the tenant that check placed the event in, so the event goes on that tenant's chain, never
// one picked from the raw slug in the URL.
//
// S5 wave 8, C19a: tenant_crew, and Stellr-only for other tenants. Badges print on Stellr's
// artwork, so every handler asks stellrOnlyEvent right after the access check: a tenant's
// staff get its 503, another tenant's event is a 404 for everyone, a Stellr admin included,
// and a failed read of the event's owner is a retryable 503. Stellr's own events answer as before.

const ROUTE = '/api/admin/events/[slug]/badge-templates'

// The template row is the target; format, audience (enums) and company id the metadata.
const saveAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.badge_template.save' as const, ...auditSubject(req, 'event_badge_templates') })
const deleteAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.badge_template.delete' as const, ...auditSubject(req, 'event_badge_templates') })
type Ctx = { params: Promise<{ slug: string }> }

export const PUT = withAudit(saveAudit, saveBadgeTemplate)
export const DELETE = withAudit(deleteAudit, deleteBadgeTemplate)

// Name badge templates: one background per Avery format per audience
// (everyone, mentors, teachers, or one company). GET lists the event's own with its
// theme's defaults (everyone/mentors, standing in for any slot the event has
// not filled) and its companies; PUT sets the event's artwork (uploaded
// browser → storage via /api/uploads/sign, kind = the format's artworkKind)
// and/or moves the name; DELETE removes one of the event's own backgrounds.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const db = stellrOnlyDb(crew.scope, supabaseServer())
  const theme = await eventArtworkTheme(slug)
  const [templates, defaults, companies] = await Promise.all([
    loadBadgeTemplates(db, slug),
    loadDefaultBadgeTemplates(db, theme),
    loadCompanies(db, slug),
  ])
  return NextResponse.json({ theme, templates: await fillPlacements(db, templates), defaults, companies })
}

const AUDIENCES: BadgeAudience[] = ['everyone', 'mentors', 'teachers', 'company']

// PUT { format, audience, companyId?, storagePath?, fileType?, name_x?, name_y?, name_max_width?, name_size?, reset? }
// New artwork resets the placement to one found from the artwork's rule;
// the reply says whether a rule was found.
async function saveBadgeTemplate(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const format = b.format
  const audience = b.audience as BadgeAudience
  const companyId = audience === 'company' && typeof b.companyId === 'string' ? b.companyId : null
  if (!isBadgeFormat(format) || !AUDIENCES.includes(audience) || (audience === 'company' && !companyId)) {
    return NextResponse.json({ error: 'format and audience (with companyId for a company) are required' }, { status: 400 })
  }

  noteAuditSubject(req, { detail: { format, audience, ...bodyIds({ company_id: companyId }, ['company_id']) } })
  const db = stellrOnlyDb(crew.scope, supabaseServer())
  if (companyId && !(await eventHasCompany(db, slug, companyId))) {
    return NextResponse.json({ error: 'That company is not in this event' }, { status: 400 })
  }

  const slot = { format, audience, companyId }
  const existingId = await findEventBadgeTemplateId(db, slug, slot)

  const update: Record<string, unknown> = {}
  let lineFound: boolean | null = null

  const art = await claimArtwork(b, 'event-artwork', `event-artwork/${slug}/${BADGE_FORMATS[format].artworkKind}-`)
  if (art && 'error' in art) return NextResponse.json({ error: art.error }, { status: art.status })
  if (art) {
    update.artwork_path = art.path
    const found = await badgePlacementFromArtwork(art, format)
    lineFound = found.lineFound
    Object.assign(update, found.placement)
  } else {
    const placement = placementInput(b, BADGE_PLACEMENT_RANGES)
    if ('error' in placement) return NextResponse.json({ error: placement.error }, { status: 400 })
    Object.assign(update, placement.values)
  }

  // Back to the position found from the artwork's rule.
  if (b.reset === true && !art && existingId) {
    const t = await loadBadgeTemplate(db, slug, existingId)
    const prepared = t ? await prepareTemplate(db, t) : null
    if (!prepared) return NextResponse.json({ error: 'The background could not be loaded. Upload it again.' }, { status: 500 })
    lineFound = prepared.line !== null
    const p = placementFromLine(prepared.line, format)
    Object.assign(update, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
  }

  if (!existingId && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the background before positioning the name.' }, { status: 400 })
  }

  const { data: saved, error } = await saveEventBadgeTemplate(db, slug, existingId, slot, update)
  if (error || !saved) {
    console.error('[badge templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  noteAuditSubject(req, { id: saved.id })
  return NextResponse.json({ ok: true, lineFound, template: await loadBadgeTemplate(db, slug, saved.id) })
}

// DELETE ?id= — drop one of the event's backgrounds. Those badges fall back to
// the next one down (mentors/teachers → company → everyone, the theme default standing
// in for a mentors or everyone slot the event no longer has → plain).
async function deleteBadgeTemplate(req: Request, { params }: Ctx) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: ROUTE })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, ROUTE)
  if (foreign) return foreign
  const id = new URL(req.url).searchParams.get('id') ?? ''
  noteAuditSubject(req, { id })
  const { error } = await deleteEventBadgeTemplate(stellrOnlyDb(crew.scope, supabaseServer()), slug, id)
  if (error) {
    console.error('[badge templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
