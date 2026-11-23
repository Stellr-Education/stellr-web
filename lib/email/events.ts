import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseEmail } from '@/lib/email/suppressions'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { maskEmail } from '@/lib/utils'

// The email events store (table email_events, migration 20261123200000; email
// plan Workstream C). Every delivery event the mail provider reports is kept
// per message: the engagement base the in-portal community email will read,
// and the source of History's per-recipient delivery status and the
// dashboard's bounce and complaint rates.
//
// Written from the Resend webhook (app/api/webhooks/resend) beside the two
// older consumers, which are unchanged: lib/esign/bounces.ts and
// lib/email/suppressions.ts. Workstream F's SES webhook feeds the same table
// with provider 'ses'.
//
// Idempotent: the row's key is (provider, provider email id, type, time), so a
// redelivered webhook writes nothing; a second open or click at a later time is
// a row of its own.
//
// Where a row's tenant, stream, feature and ref come from, first match wins:
//   1. the send's Resend tags (Workstream A adds stream, tenant_id, feature,
//      ref, and member_id where it has one);
//   2. the outbox row that sent it (email_outbox.provider_id): tenant, and the
//      stream from its kind;
//   3. the event-email run that recorded the Resend id against a recipient
//      (event_email_sends.recipients[].resendId): tenant, event slug, member;
//   4. the signing invitation that holds it (agreement_recipients.invite_email_id);
//   5. otherwise Stellr, with stream, feature and ref left empty.
// The member is the tag's, else the run's, else the members row with that
// address. Lookups are best effort: a failed one leaves the field empty, while
// a failed write throws so the webhook answers 500 and Resend retries.
//
// Kept from the payload: bounce type, sub-type and message, the failure reason.
// Never the subject, the body, an IP address or a user agent. A clicked link is
// kept as origin and path only: a query string can carry a token.

export const EMAIL_EVENT_TYPES = [
  'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained',
  'opened', 'clicked', 'suppressed', 'failed',
] as const
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number]

export type EmailProvider = 'resend' | 'ses'

/** Resend webhook type → stored type. Anything else (email.scheduled, email.received, …) is not stored. */
export const RESEND_EVENT_TYPE: Readonly<Record<string, EmailEventType>> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.suppressed': 'suppressed',
  'email.failed': 'failed',
}

/** How long rows are kept (retention schedule row 37; /api/cron/email-events-retention). */
export const EMAIL_EVENTS_RETENTION_MONTHS = 13

/** The parts of a Resend webhook event this module reads. */
export interface ResendWebhookEvent {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    created_at?: string
    to?: string[] | string
    tags?: Record<string, unknown> | { name?: unknown; value?: unknown }[]
    bounce?: { message?: string; type?: string; subType?: string }
    click?: { link?: string; timestamp?: string }
    failed?: { reason?: string }
    suppressed?: { message?: string; type?: string }
  }
}

/** Context the send attached to the message, read from its Resend tags. */
export interface EmailContext {
  tenantId: string | null
  stream: string | null
  feature: string | null
  ref: string | null
  memberId: string | null
}

/** A Resend event turned into the row's provider-side fields (pure; no lookups yet). */
export interface MappedEmailEvent {
  provider: EmailProvider
  providerEmailId: string
  type: EmailEventType
  recipient: string
  occurredAt: string
  linkUrl: string | null
  payloadMin: Record<string, unknown>
  tags: EmailContext
}

export interface EmailEventRow {
  provider: EmailProvider
  provider_email_id: string
  type: EmailEventType
  tenant_id: string
  member_id: string | null
  recipient: string
  recipient_hash: string
  stream: string | null
  feature: string | null
  ref: string | null
  link_url: string | null
  occurred_at: string
  payload_min: Record<string, unknown>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** sha256 hex of the normalised address. */
export function hashRecipient(email: string): string {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex')
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

/** Resend tags as a plain map. Webhooks send an object; the send API takes [{ name, value }]. Both are read. */
export function readTags(tags: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (Array.isArray(tags)) {
    for (const t of tags as { name?: unknown; value?: unknown }[]) {
      if (t && typeof t.name === 'string' && typeof t.value === 'string') out[t.name] = t.value
    }
  } else if (tags && typeof tags === 'object') {
    for (const [k, v] of Object.entries(tags)) if (typeof v === 'string') out[k] = v
  }
  return out
}

/** The context fields from the tags, validated; anything malformed is dropped. */
export function contextFromTags(tags: Record<string, string>): EmailContext {
  const uuid = (v: string | undefined) => (v && UUID.test(v) ? v.toLowerCase() : null)
  return {
    tenantId: uuid(tags.tenant_id),
    stream: text(tags.stream, 40),
    feature: text(tags.feature, 80),
    ref: text(tags.ref, 200),
    memberId: uuid(tags.member_id),
  }
}

/** A clicked link as stored: http(s) origin and path only. Null for anything else. */
export function linkForStorage(link: unknown): string | null {
  if (typeof link !== 'string' || !link) return null
  try {
    const u = new URL(link)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.origin}${u.pathname}`.slice(0, 2000)
  } catch {
    return null
  }
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Map a Resend webhook event to the row's provider-side fields. Null when the
 * event is not one we store, or has no message id or recipient.
 *
 * occurred_at is the event's own time (top-level created_at), which Resend
 * repeats unchanged on a redelivery, so it keys the row. A click falls back
 * to the click's timestamp, anything else to the message's created_at.
 */
export function mapResendEvent(event: ResendWebhookEvent): MappedEmailEvent | null {
  const type = RESEND_EVENT_TYPE[event?.type]
  const data = event?.data
  if (!type || !data) return null
  const providerEmailId = text(data.email_id, 200)
  const to = (Array.isArray(data.to) ? data.to : [data.to]).filter((e): e is string => typeof e === 'string' && e.includes('@'))
  if (!providerEmailId || to.length === 0) return null
  const occurredAt = isoOrNull(event.created_at) ?? isoOrNull(data.click?.timestamp) ?? isoOrNull(data.created_at)
  if (!occurredAt) return null

  const payloadMin: Record<string, unknown> = {}
  if (to.length > 1) payloadMin.to_count = to.length
  if (type === 'bounced' && data.bounce) {
    payloadMin.bounce = {
      ...(text(data.bounce.type, 40) ? { type: text(data.bounce.type, 40) } : {}),
      ...(text(data.bounce.subType, 60) ? { sub_type: text(data.bounce.subType, 60) } : {}),
      ...(text(data.bounce.message, 300) ? { message: text(data.bounce.message, 300) } : {}),
    }
  }
  if (type === 'failed' && text(data.failed?.reason, 300)) payloadMin.reason = text(data.failed?.reason, 300)
  if (type === 'suppressed' && data.suppressed) {
    payloadMin.suppressed = {
      ...(text(data.suppressed.type, 40) ? { type: text(data.suppressed.type, 40) } : {}),
      ...(text(data.suppressed.message, 300) ? { message: text(data.suppressed.message, 300) } : {}),
    }
  }

  return {
    provider: 'resend',
    providerEmailId,
    type,
    // One row per message: our sends address one recipient each. A rare
    // multi-recipient message is stored against its first address, with the
    // count kept in payload_min.
    recipient: normaliseEmail(to[0]).slice(0, 320),
    occurredAt,
    linkUrl: type === 'clicked' ? linkForStorage(data.click?.link) : null,
    payloadMin,
    tags: contextFromTags(readTags(data.tags)),
  }
}

const STREAM_FROM_OUTBOX_KIND: Record<string, string> = { transactional: 'transactional', marketing: 'community' }

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Fill in what the tags did not say from the rows that sent the message.
 * Best effort: a failed lookup is logged and skipped.
 */
export async function resolveEmailContext(db: SupabaseClient, mapped: MappedEmailEvent): Promise<EmailContext> {
  const ctx: EmailContext = { ...mapped.tags }
  const id = mapped.providerEmailId
  const complete = () => ctx.tenantId && ctx.stream && ctx.feature && ctx.memberId
  const fill = (from: Partial<EmailContext>) => {
    for (const k of Object.keys(from) as (keyof EmailContext)[]) if (!ctx[k] && from[k]) ctx[k] = from[k] as string
  }
  const attempt = async (what: string, fn: () => Promise<void>) => {
    if (complete()) return
    try {
      await fn()
    } catch (err) {
      console.warn(`[email-events] ${what} lookup failed:`, err instanceof Error ? err.message : err)
    }
  }

  await attempt('outbox', async () => {
    const { data, error } = await db.from('email_outbox').select('tenant_id, kind').eq('provider_id', id).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return
    const row = data as { tenant_id?: string | null; kind?: string | null }
    fill({ tenantId: row.tenant_id ?? STELLR_TENANT_ID, stream: STREAM_FROM_OUTBOX_KIND[row.kind ?? ''] ?? null })
  })

  await attempt('event email run', async () => {
    const { data, error } = await db
      .from('event_email_sends')
      .select('tenant_id, event_slug, recipients')
      .contains('recipients', [{ resendId: id }])
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return
    const row = data as { tenant_id?: string | null; event_slug?: string | null; recipients?: { resendId?: string; memberId?: string | null }[] | null }
    const who = (row.recipients ?? []).find((r) => r?.resendId === id)
    // Event logistics mail is transactional (email plan, Workstream B); a send
    // that says otherwise does so in its tags, which were read first.
    fill({
      tenantId: row.tenant_id ?? STELLR_TENANT_ID,
      stream: 'transactional',
      feature: 'event_email',
      ref: row.event_slug ?? null,
      memberId: who?.memberId && UUID.test(who.memberId) ? who.memberId : null,
    })
  })

  await attempt('signing invitation', async () => {
    if (ctx.feature && ctx.tenantId) return
    const { data, error } = await db.from('agreement_recipients').select('tenant_id').eq('invite_email_id', id).limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return
    fill({ tenantId: (data as { tenant_id?: string | null }).tenant_id ?? STELLR_TENANT_ID, stream: 'transactional', feature: 'esign' })
  })

  if (!ctx.memberId) {
    try {
      const { data, error } = await db.from('members').select('id').ilike('email', escapeLike(mapped.recipient)).limit(2)
      if (error) throw new Error(error.message)
      if (data?.length === 1) ctx.memberId = (data[0] as { id: string }).id
    } catch (err) {
      console.warn('[email-events] member lookup failed:', err instanceof Error ? err.message : err)
    }
  }

  return ctx
}

export function toRow(mapped: MappedEmailEvent, ctx: EmailContext): EmailEventRow {
  return {
    provider: mapped.provider,
    provider_email_id: mapped.providerEmailId,
    type: mapped.type,
    tenant_id: ctx.tenantId ?? STELLR_TENANT_ID,
    member_id: ctx.memberId,
    recipient: mapped.recipient,
    recipient_hash: hashRecipient(mapped.recipient),
    stream: ctx.stream,
    feature: ctx.feature,
    ref: ctx.ref,
    link_url: mapped.linkUrl,
    occurred_at: mapped.occurredAt,
    payload_min: mapped.payloadMin,
  }
}

const ON_CONFLICT = 'provider,provider_email_id,type,occurred_at'

async function insertRow(db: SupabaseClient, row: EmailEventRow): Promise<{ inserted: boolean; error: { message: string; code?: string } | null }> {
  const { data, error } = await db.from('email_events').upsert(row, { onConflict: ON_CONFLICT, ignoreDuplicates: true }).select('id')
  return { inserted: !error && Array.isArray(data) && data.length > 0, error: error as { message: string; code?: string } | null }
}

/**
 * Record one provider event. Returns whether a new row was written (false for
 * a redelivery or an event type that is not stored). Throws when the write
 * fails, so the webhook answers 500 and the provider retries.
 *
 * A tenant or member id from a tag that no longer exists (foreign key
 * violation) is not retried forever: the row is written once more under
 * Stellr with no member, marked unresolved.
 */
export async function recordEmailEvent(
  db: SupabaseClient,
  event: ResendWebhookEvent,
): Promise<{ recorded: boolean; type: EmailEventType | null }> {
  const mapped = mapResendEvent(event)
  if (!mapped) return { recorded: false, type: null }
  const ctx = await resolveEmailContext(db, mapped)
  const row = toRow(mapped, ctx)

  let { inserted, error } = await insertRow(db, row)
  if (error?.code === '23503') {
    console.warn(`[email-events] ${mapped.type} for ${maskEmail(mapped.recipient)}: tenant or member not found; stored under Stellr`)
    ;({ inserted, error } = await insertRow(db, {
      ...row,
      tenant_id: STELLR_TENANT_ID,
      member_id: null,
      payload_min: { ...row.payload_min, unresolved: true },
    }))
  }
  if (error) throw new Error(`Recording the email event failed: ${error.message}`)
  return { recorded: inserted, type: mapped.type }
}

/** The prune cutoff: rows that occurred before it are older than the retention window. */
export function emailEventsCutoff(now: Date): string {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - EMAIL_EVENTS_RETENTION_MONTHS)
  return d.toISOString()
}

/**
 * Delete every email_events row older than the retention window (13 months).
 * Throws on a failed delete so the cron records the run as failed.
 */
export async function pruneEmailEvents(db: SupabaseClient, now: Date): Promise<{ cutoff: string; deleted: number }> {
  const cutoff = emailEventsCutoff(now)
  const { error, count } = await db.from('email_events').delete({ count: 'exact' }).lt('occurred_at', cutoff)
  if (error) throw new Error(`Pruning email events failed: ${error.message}`)
  return { cutoff, deleted: count ?? 0 }
}
