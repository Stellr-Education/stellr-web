import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canSend, recordSend, type EmailKind } from '@/lib/email-budget'
import { lookupSuppressions, normaliseEmail, suppressionBlocks } from '@/lib/email/suppressions'
import {
  EmailSendError,
  resendTransport,
  sendRespectingRateLimit,
  type EmailTransport,
  type OutgoingEmail,
} from '@/lib/email/transport'
import { maskEmail } from '@/lib/utils'
import type { CronRun } from '@/lib/cron-runs'
import { runPerTenant } from '@/lib/cron-tenants'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'
import { recordUsage } from '@/lib/usage/record'

// The email outbox (table email_outbox, migration 20261109224229).
//
// Resend's Free plan allows 100 emails a day for everything Stellr sends. When
// Resend refuses a send for a reason that will pass — the daily or monthly
// quota, the per-second rate limit after retries, an outage, a key or domain
// problem — sendEmail() (lib/email.ts) does not throw the mail away: it writes
// the finished message here and returns { queued: true }. The email-outbox cron
// (app/api/cron/email-outbox, several times a day) sends what is waiting,
// transactional mail first, oldest first, until Resend refuses again; whatever
// is left waits for the next run. Mail is delayed, never dropped.
//
// The only mail that leaves the outbox unsent:
//   • status 'failed'     — Resend said the message itself is invalid (HTTP 400
//                           or 422, e.g. a malformed address). Sending it again
//                           cannot work; the error is kept on the row.
//   • status 'suppressed' — the address was put on the suppression list while
//                           the mail waited, and the list stops this kind of
//                           mail (the same rule sendEmail applies).
//
// What is stored is the message exactly as it would have gone: already routed
// (outside production, to the dev safelist) and already past the suppression
// check. Attachments are stored once per distinct file in email_outbox_blobs, so
// an event email with a PDF queued for 200 people keeps one copy of the PDF.
//
// A row is claimed ('sending') before it is sent and the send carries the row
// id as Resend's Idempotency-Key, so two drains cannot both send it and a drain
// killed between Resend's answer and the row update does not send it twice when
// the stale claim is retaken.
//
// Per tenant (S5 B24). A row carries the tenant whose sender queued it
// (email_outbox.tenant_id, migration 20261116190925). Stellr's own mail leaves
// it NULL, and NULL counts as Stellr's (decision WD-2), so Stellr's rows are
// written exactly as before. The drain runs each tenant with mail waiting
// through runPerTenant (lib/cron-tenants.ts): Stellr first, on its own read, so
// another tenant's backlog can never fill Stellr's batch; then each other
// tenant on its own read and time slice, so one tenant's failure is recorded
// against it and the next still runs. A run with only Stellr's mail is the
// runner's plain call: the same reads, sends, order and result as before.
//
// One Resend account and one verified domain carry every tenant's mail, so a
// refusal that holds for the account (a quota, the rate limit, an outage, a key
// or domain problem) stops the whole run: later tenants are not tried and wait
// for the next one. The marketing budget stops only that tenant's bulk mail.
// Another tenant's rows go out only while TENANT_EVENT_MAIL_ENABLED is on, as
// every other tenant mail path does (lib/event-emails/tenant-mail.ts), and only
// while the tenant is active; otherwise they are held and counted.

export type OutboxReason = 'daily_quota' | 'monthly_quota' | 'rate_limit' | 'budget' | 'provider_error'

export interface StoredAttachment {
  filename: string
  contentType?: string
  sha256: string
}

type StoredMessage = Omit<OutgoingEmail, 'attachments'> & { attachments?: StoredAttachment[] }

export interface OutboxRow {
  id: string
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'suppressed'
  kind: EmailKind
  priority: number
  critical: boolean
  intended_to: string
  intended_cc: string[]
  message: StoredMessage
  attachment_hashes: string[]
  reason: OutboxReason
  attempts: number
  last_error: string | null
  next_attempt_at: string
  claimed_at: string | null
  created_at: string
  /** S5 B24: the tenant whose sender queued it. NULL is Stellr's (WD-2). */
  tenant_id?: string | null
}

/** Why Resend's refusal (or a failed request) means "wait", or null when it means "this message is bad". */
export function deferReason(err: unknown): OutboxReason | null {
  if (!(err instanceof EmailSendError)) return 'provider_error' // network failure, timeout
  if (err.isPermanent) return null
  if (err.status === 429) {
    if (err.code === 'monthly_quota_exceeded') return 'monthly_quota'
    if (err.isRateLimit) return 'rate_limit'
    return 'daily_quota'
  }
  return 'provider_error'
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * Put a message in the outbox. Returns the row id, or null when it could not be
 * written (the caller then throws the original error, as before the outbox).
 */
export async function enqueueEmail(
  db: SupabaseClient,
  entry: {
    message: OutgoingEmail
    kind: EmailKind
    critical: boolean
    intendedTo: string
    intendedCc: string[]
    reason: OutboxReason
    error?: string
    /**
     * S5 B24: the tenant whose sender queued this message. Stellr's id, null or
     * absent all store NULL (WD-2), so Stellr's rows are written as before.
     */
    tenantId?: string | null
  },
): Promise<string | null> {
  const queuedAt = new Date().toISOString()
  try {
    const { attachments, ...rest } = entry.message
    const stored: StoredAttachment[] = []
    if (attachments?.length) {
      const now = queuedAt
      const blobs = new Map<string, string>()
      for (const a of attachments) {
        const hash = sha256(a.content)
        blobs.set(hash, a.content)
        stored.push({ filename: a.filename, ...(a.contentType ? { contentType: a.contentType } : {}), sha256: hash })
      }
      // created_at is refreshed on every queue, so the blob prune (which only
      // takes blobs older than a day that no waiting row names) cannot remove a
      // file between this write and the row insert below.
      const { error } = await db
        .from('email_outbox_blobs')
        .upsert([...blobs].map(([hash, content]) => ({ sha256: hash, content, created_at: now })), { onConflict: 'sha256' })
      if (error) throw new Error(`attachment write failed: ${error.message}`)
    }
    const message: StoredMessage = { ...rest, ...(stored.length ? { attachments: stored } : {}) }
    const { data, error } = await db
      .from('email_outbox')
      .insert({
        status: 'pending',
        kind: entry.kind,
        priority: entry.kind === 'transactional' ? 0 : 1,
        critical: entry.critical,
        intended_to: entry.intendedTo,
        intended_cc: entry.intendedCc,
        message,
        attachment_hashes: stored.map((a) => a.sha256),
        reason: entry.reason,
        last_error: entry.error?.slice(0, 500) ?? null,
        attempts: 0,
        next_attempt_at: queuedAt,
        created_at: queuedAt,
        ...(entry.tenantId && entry.tenantId !== STELLR_TENANT_ID ? { tenant_id: entry.tenantId } : {}),
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  } catch (err) {
    console.error('[email-outbox] could not queue mail for', maskEmail(normaliseEmail(entry.intendedTo)), '—', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Draining ──────────────────────────────────────────────────────────────────

/** A claim older than this belongs to a killed run and is taken back. */
const STALE_CLAIM_MS = 10 * 60_000
/** Sent and suppressed rows are kept this long for support questions, then removed. */
const KEEP_DONE_MS = 14 * 86_400_000
/** Mail waiting longer than this marks the cron run failed, so it shows up. */
export const STALE_WAIT_MS = 48 * 3_600_000

export interface DrainResult {
  sent: number
  failed: number
  suppressed: number
  /** Rows still waiting after this run. */
  waiting: number
  /** Age of the oldest waiting row, in hours (null when nothing waits). */
  oldestWaitingHours: number | null
  /** Why the run stopped before the outbox was empty. */
  stoppedFor: OutboxReason | 'deadline' | null
  /**
   * S5 B24: other tenants' rows held because tenant mail is off. Present only
   * when non-zero, so a Stellr-only run's result keeps its keys.
   */
  tenantHeld?: number
}

/** The runner's ledger (tenants, skipped, notReached, cursor). Empty for a Stellr-only run. */
export type DrainOutcome = DrainResult & { ledger: Record<string, unknown> }

type TenantDrain = Pick<DrainResult, 'sent' | 'failed' | 'suppressed' | 'stoppedFor'>

/** Refusals that hold for the whole Resend account, so no later tenant is tried this run. */
const ACCOUNT_STOPS: ReadonlySet<string> = new Set<OutboxReason>(['daily_quota', 'monthly_quota', 'rate_limit', 'provider_error'])

/** Most other tenants one run looks for. The rest are found on a later run. */
export const MAX_OUTBOX_TENANTS = 50

/** The run's budget when the caller gives no deadline. */
const DEFAULT_BUDGET_MS = 45_000

function backoffMs(attempts: number): number {
  return Math.min(30 * 60_000 * 2 ** Math.max(0, attempts - 1), 12 * 3_600_000)
}

/** A run that records nowhere, for a caller with no cron_runs row. Failures are still logged. */
const unrecordedRun: CronRun = {
  id: null,
  fail: (where, err) => console.error(`[email-outbox] ${where}:`, err instanceof Error ? err.message : err),
  finish: async () => {},
}

/**
 * Other tenants with mail due now, in id order. One small read per tenant (the
 * next id after the last), so a large backlog of one tenant, held or not, can
 * never hide another. Throws when the outbox cannot be read.
 */
async function tenantsWithWork(db: SupabaseClient, nowIso: string): Promise<string[]> {
  const ids: string[] = []
  let after: string | null = null
  for (let i = 0; i < MAX_OUTBOX_TENANTS; i++) {
    let query = db
      .from('email_outbox')
      .select('tenant_id')
      .eq('status', 'pending')
      .lte('next_attempt_at', nowIso)
      .not('tenant_id', 'is', null)
      .neq('tenant_id', STELLR_TENANT_ID)
    if (after) query = query.gt('tenant_id', after)
    const { data, error } = await query.order('tenant_id', { ascending: true }).limit(1).maybeSingle()
    if (error) throw new Error(`email outbox tenant read failed: ${error.message}`)
    const id = (data as { tenant_id?: string | null } | null)?.tenant_id
    if (!id) break
    ids.push(id)
    after = id
  }
  return ids
}

/** Other tenants' rows still waiting, while tenant mail is off. A count only. Throws on a failed read. */
async function heldTenantRows(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from('email_outbox')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'sending'])
    .not('tenant_id', 'is', null)
    .neq('tenant_id', STELLR_TENANT_ID)
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Send what is waiting, transactional first and oldest first, until the
 * outbox is empty, Resend refuses again, or `deadline` (epoch ms) passes.
 * Each tenant with mail waiting is drained on its own (see the header).
 * Never throws for a single message; throws only when Stellr's mail cannot be
 * read on a Stellr-only run, as before. Another tenant's failure is recorded on
 * `run` against that tenant, and the rest still run.
 */
export async function drainEmailOutbox(
  db: SupabaseClient,
  opts: {
    apiKey?: string
    transport?: EmailTransport
    deadline?: number
    limit?: number
    now?: () => Date
    /** The cron's ledger row; per-tenant failures and child rows go on it. */
    run?: CronRun
    /** S5 B24: TENANT_EVENT_MAIL_ENABLED, read by the caller. Off holds every other tenant's rows. */
    tenantMail?: boolean
  } = {},
): Promise<DrainOutcome> {
  const now = opts.now ?? (() => new Date())
  const run = opts.run ?? unrecordedRun
  const result: DrainResult = { sent: 0, failed: 0, suppressed: 0, waiting: 0, oldestWaitingHours: null, stoppedFor: null }
  const apiKey = opts.apiKey ?? process.env.RESEND_API_KEY
  const transport = opts.transport ?? (apiKey ? resendTransport(apiKey) : null)
  if (!transport) {
    console.warn('[email-outbox] No RESEND_API_KEY — not draining')
    return { ...(await finish(db, result, now)), ledger: {} }
  }

  // Take back claims a killed run left behind.
  await db
    .from('email_outbox')
    .update({ status: 'pending', claimed_at: null })
    .eq('status', 'sending')
    .lt('claimed_at', new Date(now().getTime() - STALE_CLAIM_MS).toISOString())

  // Stellr always has a turn, so a quiet run reads its mail as it always has.
  let others: string[] = []
  try {
    if (opts.tenantMail) others = await tenantsWithWork(db, now().toISOString())
    else {
      const held = await heldTenantRows(db)
      if (held) result.tenantHeld = held
    }
  } catch (err) {
    run.fail('tenants', err)
  }
  const tenantIds = [STELLR_TENANT_ID, ...others]
  const alone = tenantIds.length === 1

  let accountStop: OutboxReason | null = null
  const stellrFailure: unknown[] = []
  const outcome = await runPerTenant<TenantDrain>(db, run, {
    job: 'email-outbox',
    deadline: opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS,
    tenantIds,
    fn: async (job) => {
      if (accountStop) return { sent: 0, failed: 0, suppressed: 0, stoppedFor: accountStop }
      try {
        const drained = await drainTenant(db, transport, job.tenant.id, {
          limit: opts.limit ?? 200,
          now,
          stop: () => job.signal.aborted || Date.now() > job.deadline,
        })
        if (drained.stoppedFor && ACCOUNT_STOPS.has(drained.stoppedFor)) accountStop = drained.stoppedFor as OutboxReason
        return drained
      } catch (err) {
        // Stellr alone: an unreadable outbox ends the run as it always has (the
        // cron's 500), rather than becoming a recorded tenant failure.
        if (!alone) throw err
        stellrFailure.push(err)
        return { sent: 0, failed: 0, suppressed: 0, stoppedFor: null }
      }
    },
  })
  if (stellrFailure.length) throw stellrFailure[0]

  for (const drained of outcome.results.values()) {
    result.sent += drained.sent
    result.failed += drained.failed
    result.suppressed += drained.suppressed
    result.stoppedFor ??= drained.stoppedFor
  }
  if (!result.stoppedFor && outcome.notReached.length) result.stoppedFor = 'deadline'
  return { ...(await finish(db, result, now)), ledger: outcome.ledger }
}

/** One tenant's waiting mail (Stellr's: NULL or Stellr's id), in priority and age order. */
async function drainTenant(
  db: SupabaseClient,
  transport: EmailTransport,
  tenantId: string,
  opts: { limit: number; now: () => Date; stop: () => boolean },
): Promise<TenantDrain> {
  const { now } = opts
  const out: TenantDrain = { sent: 0, failed: 0, suppressed: 0, stoppedFor: null }
  const due = db
    .from('email_outbox')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', now().toISOString())
  const { data, error } = await (tenantId === STELLR_TENANT_ID ? due.or(STELLR_OR_NULL) : due.eq('tenant_id', tenantId))
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(opts.limit)
  if (error) throw new Error(`email outbox read failed: ${error.message}`)

  for (const row of (data ?? []) as OutboxRow[]) {
    if (opts.stop()) { out.stoppedFor = 'deadline'; break }

    // Marketing waits behind the transactional reserve, exactly as it does live.
    // Rows are in priority order, so once marketing is refused only marketing is left.
    if (row.kind === 'marketing' && !(await canSend('marketing', db, now()))) { out.stoppedFor = 'budget'; break }

    const { data: claimed } = await db
      .from('email_outbox')
      .update({ status: 'sending', claimed_at: now().toISOString(), attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
    if (!claimed?.length) continue // another run has it

    const outcome = await sendRow(db, transport, row, now)
    if (outcome === 'sent') out.sent++
    else if (outcome === 'failed') out.failed++
    else if (outcome === 'suppressed') out.suppressed++
    else { out.stoppedFor = outcome; break }
  }
  return out
}

async function sendRow(
  db: SupabaseClient,
  transport: EmailTransport,
  row: OutboxRow,
  now: () => Date,
): Promise<'sent' | 'failed' | 'suppressed' | OutboxReason> {
  const done = (patch: Record<string, unknown>) =>
    db.from('email_outbox').update({ claimed_at: null, finished_at: now().toISOString(), ...patch }).eq('id', row.id)

  // The suppression list may have changed while the mail waited.
  let cc = row.message.cc ?? []
  try {
    const listed = await lookupSuppressions(db, [row.intended_to, ...(row.intended_cc ?? [])])
    const opts = { kind: row.kind, critical: row.critical }
    const toReason = listed.get(normaliseEmail(row.intended_to))
    if (toReason && suppressionBlocks(toReason, opts)) {
      await done({ status: 'suppressed', last_error: `Recipient is on the suppression list (${toReason})` })
      return 'suppressed'
    }
    if (listed.size) {
      const blocked = new Set(
        (row.intended_cc ?? []).map(normaliseEmail).filter((a) => {
          const r = listed.get(a)
          return !!r && suppressionBlocks(r, opts)
        }),
      )
      cc = cc.filter((a) => !blocked.has(normaliseEmail(a)))
    }
  } catch (err) {
    // Same rule as sendEmail: an unreadable list never holds mail back.
    console.error('[email-outbox] suppression lookup failed — sending anyway:', err instanceof Error ? err.message : err)
  }

  let attachments: OutgoingEmail['attachments']
  if (row.message.attachments?.length) {
    const hashes = [...new Set(row.message.attachments.map((a) => a.sha256))]
    const { data: blobs, error } = await db.from('email_outbox_blobs').select('sha256, content').in('sha256', hashes)
    if (error) {
      await db.from('email_outbox').update({ status: 'pending', claimed_at: null, last_error: `attachment read failed: ${error.message}` }).eq('id', row.id)
      return 'provider_error'
    }
    const byHash = new Map((blobs ?? []).map((b) => [b.sha256 as string, b.content as string]))
    const missing = hashes.filter((h) => !byHash.has(h))
    if (missing.length) {
      console.error('[email-outbox] attachment missing for row', row.id)
      await done({ status: 'failed', last_error: 'An attachment of this email is missing from the outbox' })
      return 'failed'
    }
    attachments = row.message.attachments.map((a) => ({
      filename: a.filename,
      content: byHash.get(a.sha256)!,
      ...(a.contentType ? { contentType: a.contentType } : {}),
    }))
  }

  const { attachments: _stored, ...message } = row.message
  void _stored
  try {
    const sent = await sendRespectingRateLimit(
      transport,
      { ...message, cc, ...(attachments ? { attachments } : {}) },
      { idempotencyKey: `email-outbox/${row.id}` },
    )
    await done({ status: 'sent', sent_at: now().toISOString(), provider_id: sent.id, last_error: null })
    await recordSend(db, now())
    // S6-USE: a queued email counts when it is sent, for the tenant it was queued
    // under (NULL is Stellr's). A no-op unless USAGE_METERING_ENABLED is on.
    recordUsage(row.tenant_id ?? STELLR_TENANT_ID, 'email')
    return 'sent'
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const reason = deferReason(err)
    if (!reason) {
      console.error('[email-outbox] Resend rejected the message for', maskEmail(normaliseEmail(row.intended_to)), '—', message)
      await done({ status: 'failed', last_error: message })
      return 'failed'
    }
    // Back in the queue. A quota refusal is retried on the next run; an outage
    // or a key/domain problem backs off so a long outage is not hammered.
    const wait = reason === 'provider_error' ? backoffMs(row.attempts + 1) : 0
    await db
      .from('email_outbox')
      .update({
        status: 'pending',
        claimed_at: null,
        reason,
        last_error: message,
        next_attempt_at: new Date(now().getTime() + wait).toISOString(),
      })
      .eq('id', row.id)
    return reason
  }
}

async function finish(db: SupabaseClient, result: DrainResult, now: () => Date): Promise<DrainResult> {
  const { count } = await db
    .from('email_outbox')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'sending'])
  result.waiting = count ?? 0
  if (result.waiting) {
    const { data: oldest } = await db
      .from('email_outbox')
      .select('created_at')
      .in('status', ['pending', 'sending'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (oldest?.created_at) {
      result.oldestWaitingHours = Math.round(((now().getTime() - new Date(oldest.created_at as string).getTime()) / 3_600_000) * 10) / 10
    }
  }
  // Housekeeping, best-effort: delivered/suppressed rows after two weeks, and
  // attachment files no waiting row needs.
  try {
    await db
      .from('email_outbox')
      .delete()
      .in('status', ['sent', 'suppressed'])
      .lt('finished_at', new Date(now().getTime() - KEEP_DONE_MS).toISOString())
    await db.rpc('prune_email_outbox_blobs')
  } catch (err) {
    console.error('[email-outbox] housekeeping failed:', err instanceof Error ? err.message : err)
  }
  return result
}
