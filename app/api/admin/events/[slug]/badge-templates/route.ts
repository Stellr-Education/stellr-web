import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
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
import { bodyIds, withAudit, type AuditMutation } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

export const dynamic = 'force-dynamic'

// Platform audit (docs/TENANCY-S5.md, C7). The handler notes who passed requireEventAccess;
// the event goes on the chain of the event's owner, read from the mirror by its slug.
/** The event in the URL, /api/admin/events/<slug>/…: only looked up, never stored from here. */
function eventSlugOf(req: Request): string {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('events')
  return at < 0 ? '' : (parts[at + 1] ?? '')
}
function eventAudit(req: Request, table: string): Omit<AuditMutation, 'action'> {
  return { ...auditSubject(req, table), tenant: { eventSlug: eventSlugOf(req) } }
}

// The template row is the target; format, audience (enums) and company id the metadata.
const saveAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.badge_template.save' as const, ...eventAudit(req, 'event_badge_templates') })
const deleteAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.badge_template.delete' as const, ...eventAudit(req, 'event_badge_templates') })
type Ctx = { params: Promise<{ slug: string }> }

export const PUT = withAudit(saveAudit, saveBadgeTemplate)
export const DELETE = withAudit(deleteAudit, deleteBadgeTemplate)

// Name badge templates: one background per Avery format per audience
// (everyone, mentors, or one company). GET lists the event's own with its
// theme's defaults (everyone/mentors, standing in for any slot the event has
// not filled) and its companies; PUT sets the event's artwork (uploaded
// browser → storage via /api/uploads/sign, kind = the format's artworkKind)
// and/or moves the name; DELETE removes one of the event's own backgrounds.

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const db = supabaseServer()
  const theme = await eventArtworkTheme(slug)
  const [templates, defaults, companies] = await Promise.all([
    loadBadgeTemplates(db, slug),
    loadDefaultBadgeTemplates(db, theme),
    loadCompanies(db, slug),
  ])
  return NextResponse.json({ theme, templates: await fillPlacements(db, templates), defaults, companies })
}

const AUDIENCES: BadgeAudience[] = ['everyone', 'mentors', 'company']

// PUT { format, audience, companyId?, storagePath?, fileType?, name_x?, name_y?, name_max_width?, name_size?, reset? }
// New artwork resets the placement to one found from the artwork's rule;
// the reply says whether a rule was found.
async function saveBadgeTemplate(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  noteAuditSubject(req, { userId: access.userId, eventSlug: slug })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const format = b.format
  const audience = b.audience as BadgeAudience
  const companyId = audience === 'company' && typeof b.companyId === 'string' ? b.companyId : null
  if (!isBadgeFormat(format) || !AUDIENCES.includes(audience) || (audience === 'company' && !companyId)) {
    return NextResponse.json({ error: 'format and audience (with companyId for a company) are required' }, { status: 400 })
  }

  noteAuditSubject(req, { detail: { format, audience, ...bodyIds({ company_id: companyId }, ['company_id']) } })
  const db = supabaseServer()
  if (companyId) {
    const { data: company } = await db.from('event_companies').select('id').eq('id', companyId).eq('event_slug', slug).maybeSingle()
    if (!company) return NextResponse.json({ error: 'That company is not in this event' }, { status: 400 })
  }

  let q = db.from('event_badge_templates').select('id').eq('event_slug', slug).eq('format', format).eq('audience', audience)
  q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null)
  const { data: existing } = await q.maybeSingle()

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
  if (b.reset === true && !art && existing) {
    const t = await loadBadgeTemplate(db, slug, existing.id)
    const prepared = t ? await prepareTemplate(db, t) : null
    if (!prepared) return NextResponse.json({ error: 'The background could not be loaded. Upload it again.' }, { status: 500 })
    lineFound = prepared.line !== null
    const p = placementFromLine(prepared.line, format)
    Object.assign(update, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
  }

  if (!existing && !update.artwork_path) {
    return NextResponse.json({ error: 'Upload the background before positioning the name.' }, { status: 400 })
  }

  const { data: saved, error } = existing
    ? await db.from('event_badge_templates').update(update).eq('id', existing.id).select('id').single()
    : await db
        .from('event_badge_templates')
        .insert({ ...update, event_slug: slug, format, audience, company_id: companyId })
        .select('id')
        .single()
  if (error || !saved) {
    console.error('[badge templates] save error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  noteAuditSubject(req, { id: saved.id })
  return NextResponse.json({ ok: true, lineFound, template: await loadBadgeTemplate(db, slug, saved.id) })
}

// DELETE ?id= — drop one of the event's backgrounds. Those badges fall back to
// the next one down (company → mentors → everyone, the theme default standing
// in for a mentors or everyone slot the event no longer has → plain).
async function deleteBadgeTemplate(req: Request, { params }: Ctx) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  noteAuditSubject(req, { userId: access.userId, eventSlug: slug, id })
  const { error } = await supabaseServer().from('event_badge_templates').delete().eq('event_slug', slug).eq('id', id)
  if (error) {
    console.error('[badge templates] delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
