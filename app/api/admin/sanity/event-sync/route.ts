import { NextResponse, type NextRequest } from 'next/server'
import { parseBody } from 'next-sanity/webhook'
import { supabaseServer } from '@/lib/supabase'
import { syncEventSpace } from '@/lib/event-space-sync'
import { fireObjectCreatedRules } from '@/lib/object-created-rules'
import { safeStrEqual } from '@/lib/secret-compare'
import { ensureDistribution } from '@/lib/survey/distributions'
import { loadSurveyEvent } from '@/lib/survey/events'
import { isRealProductionApp } from '@/lib/env-guards'
import { syncEventOptions } from '@/lib/hubspot-event-options'
import { fetchSanityEvent, syncEventMirrorSafe } from '@/lib/events/sync'

// POST /api/admin/sanity/event-sync — Sanity → Supabase access-structure sync
// (HANDOFF-CODE-REVIEW §7). Sanity is the source of truth for event CONTENT;
// admin/access (Supabase) is the source of truth for event ACCESS. On publish,
// a Sanity webhook calls this route with the event document; we upsert the
// event container, auto-provision its Event Space, and fire the
// object_created rules (auto-attach mandatory training etc.).
//
// The event↔Space pairing is keyed on the Sanity document _id, NOT the slug, so
// renaming an event in the Studio renames its Space instead of forking a second
// one and stranding the first. lib/event-space-sync carries that logic and is
// shared with `npm run sync:event-spaces`.
//
// Configure in Sanity: webhook on event create/update, URL this route, secret
// in SANITY_WEBHOOK_SECRET.
//
// Two ways in, while the live webhook moves over (deep review v2 .12):
//   1. SIGNED (the target). Sanity signs the body with the webhook's secret and
//      sends `sanity-webhook-signature`; next-sanity/webhook's parseBody checks
//      it against SANITY_WEBHOOK_SECRET.
//   2. HEADER (legacy). The same secret sent as a custom `x-webhook-secret`
//      header, compared in constant time. deep review AUTH-10 already dropped
//      the `?secret=` query form, which leaked the secret into access logs.
// A request passes if either holds and is refused otherwise; the log line says
// which path let it in, never the secret. Next: the owner switches the live
// webhook to signed delivery (docs/RUNBOOK-sanity-studio.md, "Signed event-sync
// webhook"), the logs show only "signature" for a while, and a follow-up drops
// the header path.
//
// Either way the payload is used only for the document's identity. Its fields
// are not trusted: the event is re-read from Sanity by _id (uncached), and that
// copy drives the sync. If the read fails, or returns an older revision than
// the payload names, the route answers 503 so Sanity retries.

const SIGNATURE_HEADER = 'sanity-webhook-signature'

/** The payload fields the route reads: identity and revision time only. */
interface SanityEventPayload {
  _id?: string
  _type?: string
  _updatedAt?: string
}

type AuthPath = 'signature' | 'header'

/** Which guard let the request in, or why none did. Reads only headers and the raw body. */
async function authorise(req: Request, raw: string, secret: string): Promise<AuthPath | 'bad-signature' | 'none'> {
  const signature = req.headers.get(SIGNATURE_HEADER)
  let signed = false
  if (signature) {
    try {
      // parseBody wants the request; hand it one over the body already read.
      // No eventual-consistency wait: the document is re-read below, and a
      // stale read answers 503 instead.
      const asRequest = { headers: req.headers, text: async () => raw } as unknown as NextRequest
      signed = (await parseBody(asRequest, secret, false)).isValidSignature === true
    } catch {
      signed = false // an unparseable body or a malformed header verifies nothing
    }
  }
  if (signed) return 'signature'
  const provided = req.headers.get('x-webhook-secret')
  if (provided && safeStrEqual(provided, secret)) return 'header'
  return signature ? 'bad-signature' : 'none'
}

export async function POST(req: Request) {
  // Fails closed when the secret is unset: it is the only guard on this route
  // (there is no admin session), for both paths.
  const secret = process.env.SANITY_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // A copy of the raw body for the signature, which covers the exact bytes.
  const raw = await req.clone().text().catch(() => '')
  const auth = await authorise(req, raw, secret)
  if (auth === 'bad-signature') {
    console.warn('[event-sync] refused: invalid signature and no valid header')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (auth === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  console.info(`[event-sync] authorised by ${auth === 'signature' ? 'signature' : 'x-webhook-secret header'}`)

  const body = (await req.json().catch(() => null)) as SanityEventPayload | null
  if (!body || typeof body !== 'object' || (body._type && body._type !== 'event')) {
    return NextResponse.json({ error: 'Not an event payload' }, { status: 400 })
  }
  // Without the _id there is no durable identity to match on, and matching on
  // slug is precisely the bug this route exists to avoid — so refuse rather than
  // fall back to it. Sanity sends _id on every document webhook.
  if (typeof body._id !== 'string' || !body._id) return NextResponse.json({ error: '_id required' }, { status: 400 })
  // A draft is never readable as published, so a retry could not help.
  if (body._id.startsWith('drafts.')) return NextResponse.json({ error: 'Drafts are not synced' }, { status: 400 })
  const sanityId = body._id

  // The event as Sanity holds it now, not as the payload describes it.
  let doc: Awaited<ReturnType<typeof fetchSanityEvent>>
  try {
    doc = await fetchSanityEvent({ sanityId })
  } catch (err) {
    console.error('[event-sync] re-fetch from Sanity failed:', err)
    return NextResponse.json({ error: 'Could not read the event from Sanity' }, { status: 503 })
  }
  if (!doc) {
    // Just published and not yet readable, or Sanity is not configured here.
    return NextResponse.json({ error: 'Event not readable from Sanity yet' }, { status: 503 })
  }
  if (typeof body._updatedAt === 'string' && doc._updatedAt && doc._updatedAt < body._updatedAt) {
    return NextResponse.json({ error: 'Sanity returned an older revision' }, { status: 503 })
  }

  const slug = typeof doc.slug === 'string' ? doc.slug : doc.slug?.current
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  const title = doc.title ?? slug
  const objectType = doc.activityType === 'campaign' ? ('campaign' as const) : ('event' as const)

  const db = supabaseServer()

  // Container + Space + event link + roster backfill, and a slug repair across
  // every table if the slug has moved since we last saw this _id.
  const sync = await syncEventSpace(db, { sanityId, slug, title })

  // Fire object_created rules (auto-attach configured spaces/courses/resources).
  // Not for another tenant's event: a Space rule needs no container, so it would link a
  // Stellr Space to that event, and community is Stellr-only.
  const rules = sync.skippedOtherTenant
    ? { applied: [], skipped: [] }
    : await fireObjectCreatedRules({
        objectType,
        ref: slug,
        containerId: sync.containerId ?? undefined,
      })

  // Post-event survey: schedule it for a new event, or follow a date change /
  // cancellation (lib/survey/distributions.ts). The cron sweep does the same,
  // so a failure here is logged, not fatal. Sanity is re-read rather than
  // trusting the payload, which carries no date.
  let survey: string | null = null
  if (objectType === 'event') {
    try {
      const event = await loadSurveyEvent(slug)
      if (event) {
        const r = await ensureDistribution(db, event)
        survey = r.action === 'skipped' ? `skipped: ${r.reason}` : r.action
      }
    } catch (err) {
      console.error('[event-sync] survey schedule failed:', err)
      survey = 'error'
    }
  }

  // HubSpot event options (lib/hubspot-event-options.ts): a new venue, a new
  // school year or a cancellation changes the CRM's dropdowns, and this is the
  // moment it happens. The sync re-reads every event from Sanity, so the
  // payload's shape doesn't matter. One portal, no sandbox — so only the real
  // production app writes; the daily cron catches anything missed here.
  let hubspotOptions: string | Record<string, unknown> = 'skipped: not the production app'
  if (isRealProductionApp()) {
    try {
      const r = await syncEventOptions({ apply: true, stellrOnlyDb: db })
      hubspotOptions = {
        ok: r.ok,
        refused: r.refused,
        updated: r.properties
          .filter((p) => p.status === 'updated')
          .map((p) => `${p.object}.${p.property}`),
        failed: r.properties
          .filter((p) => p.status === 'failed')
          .map((p) => `${p.object}.${p.property}: ${p.error}`),
        form: r.form.status,
        unmapped: r.unmapped,
      }
    } catch (err) {
      console.error('[event-sync] HubSpot option sync failed:', err)
      hubspotOptions = 'error'
    }
  }

  // S3 events mirror (lib/events/sync.ts): copy the event into public.events
  // so the database knows which tenant owns it. Additive and last: everything
  // above has already happened, syncEventMirrorSafe never throws, waits at
  // most MIRROR_TIMEOUT_MS and records a failure in app_errors, and the
  // try/catch is belt and braces — a mirror problem can never fail this
  // webhook. Re-read from Sanity by _id, like the survey above.
  let mirror: string
  try {
    mirror = (await syncEventMirrorSafe(db, { sanityId, slug })).status
  } catch (err) {
    console.error('[event-sync] events mirror failed:', err)
    mirror = 'error'
  }

  return NextResponse.json({
    ok: true,
    auth,
    slug,
    survey,
    hubspotOptions,
    mirror,
    containerId: sync.containerId,
    eventSpaceId: sync.spaceId,
    created: sync.created,
    renamedFrom: sync.renamedFrom,
    notes: sync.notes,
    rules,
  })
}
