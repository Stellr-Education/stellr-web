// Sends one event email: manual ("Send now"), scheduled (the daily cron), or a
// test to the person pressing the button.
//
// The row is CLAIMED before anything goes out — draft/scheduled → sending in a
// single conditional UPDATE — so a cron run and a click (or two clicks) can
// never both send it. Every send, including a test, lands in event_email_sends.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, EmailSendError } from '@/lib/email'
import { extractTokens } from '@/lib/email-render'
import { RESOURCES_BUCKET } from '@/lib/community'
import { getEventBySlugIn } from '@/lib/events/tenant-facade'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { resolveAudience, type ResolvedRecipient } from './audiences'
import { AWARD_MERGE_TOKENS, loadAwardMergeVars } from './awards'
import { alreadyTriedAddresses, latestRunFinished, missedRecipients } from './history'
import {
  EVENT_EMAIL_FROM,
  EVENT_EMAIL_REPLY_TO,
  eventMergeVars,
  recipientMergeVars,
  renderEventEmail,
  unknownTokens,
  type EventForEmail,
} from './render'
import { MAX_RECIPIENTS_PER_SEND, type EventEmailRow, type EventEmailSendRow, type EventEmailStatus } from './types'
import { isTenantRow, TENANT_SENDER_REQUIRED, type EventSender } from './tenant-mail'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { surveySendsHeld } from '@/lib/survey/hold'
import { isValidEmail } from '@/lib/member-enums'

// S5 B14: defined in tenant-mail.ts since the signing engine refuses with it too.
export { TENANT_SENDER_REQUIRED }

/** Does a row's tenant_id file it under this tenant? NULL counts as Stellr's, as derivation stamps. */
export function rowInTenant(rowTenantId: string | null | undefined, tenantId: string): boolean {
  return (rowTenantId ?? STELLR_TENANT_ID) === tenantId
}

/**
 * Recipients whose address could be an email (member-merge-school-email.12). A
 * guardian typed as "none", a blank, or an address with no @ is left out before
 * anything is claimed, recorded or sent: Resend refuses it anyway, and each
 * refusal is a failed row in History and a wasted call. Logs how many were left
 * out and for which email, never the addresses themselves.
 */
export function sendableRecipients<T extends { email: string | null | undefined }>(recipients: T[], emailId: string): T[] {
  const ok = recipients.filter((r) => isValidEmail(r.email))
  const skipped = recipients.length - ok.length
  if (skipped) console.warn(`[event-emails] email ${emailId}: skipped ${skipped} recipient(s) with no valid email address`)
  return ok
}

/**
 * Gap between sends. 550ms suited the old 2 requests/second team limit; the
 * account now allows 10/second (Resend usage, 23 Nov 2026), so EMAIL_SEND_SPACING_MS
 * can bring it down (e.g. 150) without a deploy. Never below 100ms, which keeps
 * this loop at most 10/second and leaves headroom for other senders.
 */
const SEND_SPACING_MS = (() => {
  const n = Number(process.env.EMAIL_SEND_SPACING_MS)
  return Number.isInteger(n) && n >= 100 ? n : 550
})()

// deep review INT-1: a send runs inside a ≤60s function. If it is killed
// mid-flight the row is left in 'sending' and nothing ever completes it — the
// admin PATCH refuses with 409 and the cron only picks up 'scheduled'. A row
// still 'sending' this long after the claim is treated as abandoned and
// re-driven by the cron (reclaimStuckSending). 10 minutes is far longer than
// the 60s budget, so a healthy in-progress send is never reclaimed. The
// event_emails.updated_at trigger makes the reclaiming UPDATE a safe
// compare-and-swap: taking the row bumps updated_at, so a second run no longer
// matches `updated_at < stale`.
//
// Since 17 Nov 2026 a live send also HEARTBEATS: it touches event_emails after
// every recipient (and through the DocuSign step), so updated_at is never more
// than a few seconds old while a run is alive. That lets the cron treat two
// minutes of silence as abandoned, and lets "Resume now" / the editor's
// automatic continue take a row after CONTINUE_STALE_MS of silence.
export const SENDING_STALE_MS = 2 * 60_000
export const CONTINUE_STALE_MS = 20_000

// A send stops cleanly before its function is killed (17 Nov 2026: a manual
// send to the MN consent group spent its 60s on DocuSign re-sends, was killed
// after 2 emails, and showed "Send failed." with the email stuck in 'sending').
// Each run works until its deadline, records what it did, leaves the email in
// 'sending' and says it is incomplete; the editor continues it at once and the
// cron picks up anything left behind.
export const SEND_TIME_BUDGET_MS = 45_000
/** Stop starting new recipients this close to the deadline: one send plus the final write. */
const DEADLINE_MARGIN_MS = 3_000
/** The DocuSign re-send step gets at most this much of a run, a few at a time. */
const DOCUSIGN_BUDGET_MS = 15_000
const DOCUSIGN_CONCURRENCY = 4

export type SendTrigger = 'manual' | 'schedule' | 'test' | 'catch_up'

export type SendOutcome =
  | {
      ok: true
      sendId: string
      recipients: number
      sent: number
      failed: number
      docusignResent: number
      // deep review INT-2 / PUB-4: true when the shared daily email budget ran
      // out before every recipient was reached. The email was returned to its
      // prior state (scheduled/draft) rather than marked sent, so the next cron
      // slot resumes it and sends whoever is left.
      incomplete?: boolean
      /**
       * Why it stopped early: 'time' (this run's deadline — the email stays
       * 'sending' and should be continued straight away) or 'quota' (the daily
       * budget — it went back to draft/scheduled for the next cron slot).
       */
      stoppedFor?: 'time' | 'quota'
      /** Recipients this run did not reach. */
      remaining?: number
      /** Recipients our suppression list skipped (bounced/complained before). */
      suppressed?: number
    }
  | { ok: false; status: number; error: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The event's details for an email, read for the tenant that owns the email (S5 wave 8,
 * C8-PG): an email row's tenant_id, NULL read as Stellr's. With TENANT_DB_AREAS unset this
 * is today's Sanity read.
 */
export async function loadEventForEmail(slug: string, tenantId: string): Promise<EventForEmail | null> {
  const e = (await getEventBySlugIn(tenantId, slug)) as
    | { title: string; date?: string; venue?: string; city?: string; state?: string; startTime?: string; endTime?: string }
    | null
  if (!e) return null
  return { slug, title: e.title, date: e.date, venue: e.venue, city: e.city, state: e.state, startTime: e.startTime, endTime: e.endTime }
}

/**
 * The event-level merge values for this email: the event's details, plus the
 * award winners and champion company when the email uses them (read once per
 * send, not per recipient).
 *
 * Another tenant's event gets no {{feedback_link}} while its survey is held
 * (lib/survey/hold.ts, decided from the email row's tenant_id already in hand, no
 * read): the survey page would answer its token as nobody's, so the value is
 * empty and renderEventEmail leaves out the line that carries it. Stellr's (a
 * NULL tenant included) keeps its link.
 */
export async function eventVarsFor(
  db: SupabaseClient,
  email: Pick<EventEmailRow, 'subject' | 'body_json' | 'tenant_id'>,
  event: EventForEmail,
): Promise<Record<string, string>> {
  const vars = eventMergeVars(event)
  if (surveySendsHeld(email.tenant_id ?? STELLR_TENANT_ID)) vars.feedback_link = ''
  const used = new Set([...extractTokens(email.subject), ...extractTokens(JSON.stringify(email.body_json ?? ''))])
  if (AWARD_MERGE_TOKENS.some((t) => used.has(t))) Object.assign(vars, await loadAwardMergeVars(db, event.slug))
  return vars
}

export async function loadAttachments(db: SupabaseClient, email: EventEmailRow) {
  const out: { filename: string; content: string; contentType?: string }[] = []
  for (const a of email.attachments ?? []) {
    const { data, error } = await db.storage.from(RESOURCES_BUCKET).download(a.path)
    if (error || !data) throw new Error(`Attachment “${a.filename}” could not be read`)
    out.push({
      filename: a.filename,
      content: Buffer.from(await data.arrayBuffer()).toString('base64'),
      contentType: a.contentType,
    })
  }
  return out
}

export async function sendEventEmail(
  db: SupabaseClient,
  emailId: string,
  opts: {
    trigger: Exclude<SendTrigger, 'catch_up'>
    triggeredBy?: string | null
    testTo?: string
    spacingMs?: number
    // deep review INT-1: set by reclaimStuckSending to re-drive a row abandoned
    // in 'sending'. The claim then takes a stale 'sending' row (instead of a
    // draft/scheduled one) and the send resumes, skipping addresses already
    // emailed by the killed run.
    resume?: boolean
    /**
     * How long a 'sending' row must have been silent before `resume` may take
     * it. The cron uses SENDING_STALE_MS; "Resume now" / the editor's automatic
     * continue use CONTINUE_STALE_MS. Live runs heartbeat, so neither steals one.
     */
    staleMs?: number
    /**
     * Epoch ms by which this run must have stopped (default: now +
     * SEND_TIME_BUDGET_MS). Callers that have already spent part of their
     * function's time (the cron) pass their own.
     */
    deadline?: number
    /** S5 B14: the tenant's sender, for a tenant's email. Leave out for Stellr's. */
    sender?: EventSender
    /**
     * S5 B14: a tenant cron's slice signal. Once it fires the send stops between
     * recipients and is put back for the next run, as when the daily budget runs
     * out. Stellr's sends leave it out.
     */
    signal?: AbortSignal
  },
): Promise<SendOutcome> {
  const { data: row } = await db.from('event_emails').select('*').eq('id', emailId).maybeSingle()
  const email = row as EventEmailRow | null
  if (!email) return { ok: false, status: 404, error: 'Email not found' }
  if (isTenantRow(email.tenant_id) && !opts.sender) return { ok: false, status: 503, error: TENANT_SENDER_REQUIRED }

  const bad = unknownTokens(email.subject, email.body_json)
  if (bad.length) return { ok: false, status: 400, error: `Unknown merge field${bad.length > 1 ? 's' : ''}: ${bad.map((t) => `{{${t}}}`).join(', ')}` }
  if (!email.subject.trim()) return { ok: false, status: 400, error: 'Add a subject first' }
  if (!email.audiences.length) return { ok: false, status: 400, error: 'Choose at least one group to send to' }

  const event = await loadEventForEmail(email.event_slug, email.tenant_id ?? STELLR_TENANT_ID)
  if (!event) return { ok: false, status: 404, error: 'Event not found' }

  const isTest = opts.trigger === 'test'
  if (isTest && !opts.testTo) return { ok: false, status: 400, error: 'No address to send the test to' }
  const deadline = opts.deadline ?? Date.now() + SEND_TIME_BUDGET_MS

  // ── Claim ───────────────────────────────────────────────────────────────────
  const priorStatus: EventEmailStatus = email.status
  if (!isTest) {
    if (opts.resume) {
      // Re-take a row abandoned in 'sending'. Only a row that has been 'sending'
      // longer than SENDING_STALE_MS matches, and the updated_at trigger bumps
      // the timestamp as we take it, so two concurrent reclaims can't both win.
      const stale = new Date(Date.now() - (opts.staleMs ?? SENDING_STALE_MS)).toISOString()
      let { data: claimed } = await db
        .from('event_emails')
        .update({ status: 'sending' })
        .eq('id', email.id)
        .eq('status', 'sending')
        .lt('updated_at', stale)
        .select('id')
      // A run that stopped at its time limit has recorded itself finished and
      // its last heartbeat is seconds old: a continue takes over at once. The
      // compare-and-swap on updated_at (as read above) means two continues
      // can't both win, and a run that heartbeats in between keeps the row.
      if (!claimed?.length && email.status === 'sending' && email.updated_at && (await latestRunFinished(db, email.id))) {
        ;({ data: claimed } = await db
          .from('event_emails')
          .update({ status: 'sending' })
          .eq('id', email.id)
          .eq('status', 'sending')
          .eq('updated_at', email.updated_at)
          .select('id'))
      }
      if (!claimed?.length) {
        return {
          ok: false,
          status: 409,
          error: email.status === 'sending'
            ? 'This email is still sending — give it a minute, then try again'
            : 'This email is not waiting to be resumed',
        }
      }
    } else {
      const { data: claimed } = await db
        .from('event_emails')
        .update({ status: 'sending' })
        .eq('id', email.id)
        .in('status', ['draft', 'scheduled'])
        .select('id')
      if (!claimed?.length) return { ok: false, status: 409, error: 'This email has already been sent (or is sending now)' }
    }
  }
  const release = async (status: EventEmailStatus, extra: Record<string, unknown> = {}) => {
    if (!isTest) await db.from('event_emails').update({ status, ...extra }).eq('id', email.id)
  }
  // Touch the claimed row so its updated_at shows the run is alive (see
  // SENDING_STALE_MS). Best-effort: a missed beat only makes a resume wait longer.
  const heartbeat = async () => {
    if (isTest) return
    try {
      await db.from('event_emails').update({ status: 'sending' }).eq('id', email.id).eq('status', 'sending')
    } catch (err) {
      console.error(`[event-emails] heartbeat failed for ${email.id}:`, err)
    }
  }

  try {
    const audience = await resolveAudience(db, event, email.audiences, {
      mintPayLinks: !isTest,
      // S5 wave 6: another tenant's email leaves out its consent-pending participants.
      ...(isTenantRow(email.tenant_id) ? { tenantId: email.tenant_id } : {}),
    })
    let recipients: ResolvedRecipient[] = sendableRecipients(audience.recipients, email.id)

    // deep review INT-1: skip anyone a prior (non-test) send of this email
    // already tried. For a fresh send this set is empty; for a resumed stuck
    // send it is the addresses the killed run already emailed, so nobody is
    // emailed twice. Covers every non-test trigger, not just catch-ups.
    let priorRunTried = 0
    if (!isTest) {
      const tried = await alreadyTriedAddresses(db, email.id)
      priorRunTried = tried.size
      if (tried.size) recipients = missedRecipients(recipients, tried)
    }

    if (!isTest && recipients.length > MAX_RECIPIENTS_PER_SEND) {
      await release(priorStatus)
      return {
        ok: false,
        status: 400,
        error: `${recipients.length} recipients is more than one send can handle (${MAX_RECIPIENTS_PER_SEND}). Split the groups across two emails.`,
      }
    }
    if (!isTest && recipients.length === 0 && opts.trigger === 'manual' && !opts.resume) {
      await release(priorStatus)
      return { ok: false, status: 400, error: 'Nobody matches these groups right now — nothing was sent' }
    }

    const attachments = await loadAttachments(db, email)

    // A test goes to the sender, rendered as the first real recipient would see it.
    if (isTest) {
      const sample = recipients[0]
      recipients = [{
        ...(sample ?? { firstName: 'there', roles: [], participantNames: [], isParticipant: true, payments: [], reasons: [] }),
        email: opts.testTo!,
        name: opts.testTo!,
      } as ResolvedRecipient]
    }

    // DocuSign first, so "we've just re-sent it" is true when the email lands.
    // An email carrying {{agreement_link}} is itself the Stellr signing
    // reminder, so those families are not sent a second signing email.
    let docusignResent = 0
    const carriesLink = [...extractTokens(email.subject), ...extractTokens(JSON.stringify(email.body_json ?? ''))]
      .includes('agreement_link')
    const skip = new Set(carriesLink ? audience.nativeParticipantIds ?? [] : [])
    // Only the FIRST run of an email re-sends DocuSign: a continued or resumed
    // run (or one after an earlier run already emailed people) would otherwise
    // send every family the DocuSign email again each time. The step is capped
    // at DOCUSIGN_BUDGET_MS and runs a few at a time, so it can never eat the
    // time the emails themselves need.
    const firstRun = !opts.resume && priorRunTried === 0
    if (!isTest && firstRun && email.resend_docusign && audience.docusignParticipantIds.length) {
      const ids = audience.docusignParticipantIds.filter((id) => !skip.has(id))
      const stopAt = Math.min(Date.now() + DOCUSIGN_BUDGET_MS, deadline - DEADLINE_MARGIN_MS - 10_000)
      let next = 0
      const worker = async () => {
        while (next < ids.length && Date.now() < stopAt) {
          const pid = ids[next++]
          try {
            const r = await reissueParticipantAgreement(db, pid, { eventSlug: event.slug, allowNewEnvelope: false })
            if (r.kind === 'resent') docusignResent++
          } catch (err) {
            console.error(`[event-emails] DocuSign resend failed for participant ${pid}:`, err)
          }
          await heartbeat()
        }
      }
      await Promise.all(Array.from({ length: Math.min(DOCUSIGN_CONCURRENCY, ids.length) }, worker))
      if (next < ids.length) {
        console.warn(`[event-emails] email ${email.id}: DocuSign re-send stopped at its time cap after ${next} of ${ids.length} participants`)
      }
    }

    const { sendId, sent, failed, suppressed, stoppedForQuota, stoppedForTime, stoppedForDeadline, reached } = await deliver(db, email, event, recipients, {
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
      audiences: email.audiences,
      attachments,
      docusignResent,
      spacingMs: opts.spacingMs,
      sender: opts.sender,
      signal: opts.signal,
      deadline: isTest ? undefined : deadline,
      onProgress: heartbeat,
    })
    const remaining = recipients.length - reached

    // Out of time for this run: the email STAYS 'sending' (heartbeat-fresh) so
    // the editor's automatic continue, "Resume now", or the cron's
    // reclaimStuckSending carries on with whoever is left. Nobody is emailed
    // twice: this run's recipients are on its send row.
    if (stoppedForDeadline) {
      await heartbeat()
      return { ok: true, sendId, recipients: recipients.length, sent, failed, suppressed, docusignResent, incomplete: true, stoppedFor: 'time', remaining }
    }

    // deep review INT-2 / PUB-4: if the shared daily email budget ran out
    // mid-send, do NOT mark the email 'sent' — put it back where it was so the
    // next scheduled cron slot (or an admin re-send) resumes it. The recipients
    // already emailed are on the send row, so alreadyTriedAddresses skips them
    // and only the unreached ones go out next time. Nobody is emailed twice.
    // A tenant send stopped by its cron slice (S5 B14) is put back the same way.
    if (stoppedForQuota || stoppedForTime) {
      await release(priorStatus)
      return { ok: true, sendId, recipients: recipients.length, sent, failed, suppressed, docusignResent, incomplete: true, stoppedFor: stoppedForQuota ? 'quota' : 'time', remaining }
    }

    await release('sent', { sent_at: new Date().toISOString() })

    return { ok: true, sendId, recipients: recipients.length, sent, failed, suppressed, docusignResent }
  } catch (err) {
    // Nothing (or not everything) went out: put the email back where it was so
    // it can be fixed and retried, rather than stranded in 'sending'.
    console.error(`[event-emails] send ${email.id} failed:`, err)
    await release(priorStatus)
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Send failed' }
  }
}

/**
 * Emails each recipient one at a time (Resend's rate limit) and records the
 * run in event_email_sends. Shared by a normal send and a late-registrant
 * catch-up, so both read the same in History.
 */
export async function deliver(
  db: SupabaseClient,
  email: EventEmailRow,
  event: EventForEmail,
  recipients: ResolvedRecipient[],
  opts: {
    trigger: SendTrigger
    triggeredBy?: string | null
    audiences: EventEmailRow['audiences']
    attachments: Awaited<ReturnType<typeof loadAttachments>>
    docusignResent?: number
    spacingMs?: number
    /** S5 B14: a tenant's sender. Stellr's mail leaves it out and keeps EVENT_EMAIL_FROM. */
    sender?: EventSender
    /** S5 B14: stop between recipients once this fires (a tenant cron's slice). Nobody unreached is recorded. */
    signal?: AbortSignal
    /** Epoch ms: stop between recipients before this, so the run ends cleanly instead of being killed. */
    deadline?: number
    /** Called after each recipient (the heartbeat). */
    onProgress?: () => Promise<void>
  },
): Promise<{
  sendId: string
  sent: number
  failed: number
  /** Skipped by our suppression list (an earlier bounce or complaint). */
  suppressed: number
  /** How many recipients this run dealt with (sent, failed or suppressed). */
  reached: number
  stoppedForQuota: boolean
  stoppedForTime: boolean
  stoppedForDeadline: boolean
}> {
  const isTest = opts.trigger === 'test'
  const eventVars = await eventVarsFor(db, email, event)
  // History shows the subject as it went out (first recipient's rendering),
  // not the template with its {{fields}}.
  let sentSubject = email.subject
  try {
    if (recipients[0]) sentSubject = renderEventEmail(email, { ...eventVars, ...recipientMergeVars(recipients[0]) }).subject
  } catch { /* keep the template subject */ }

  const { data: sendRow } = await db
    .from('event_email_sends')
    .insert({
      event_email_id: email.id,
      event_slug: email.event_slug,
      email_name: email.name,
      subject: sentSubject,
      audiences: opts.audiences,
      trigger: opts.trigger,
      triggered_by: opts.triggeredBy ?? null,
      recipient_count: recipients.length,
      docusign_resent: opts.docusignResent ?? 0,
    })
    .select('id')
    .single()

  const results: EventEmailSendRow['recipients'] = []
  // deep review INT-1: persist progress after EACH recipient, not only at the
  // end. A send runs in a ≤60s function; if it is killed mid-loop the earlier
  // write means every address already tried is on the row, so a re-run
  // (resumed stuck send, or the next catch-up) skips them instead of emailing
  // them again. Best-effort: a failed progress write never aborts the send, and
  // the authoritative counts land in the final update below.
  const persistProgress = async () => {
    if (!sendRow?.id) return
    try {
      await db.from('event_email_sends').update({ recipients: results }).eq('id', sendRow.id)
    } catch (err) {
      console.error(`[event-emails] progress write failed for send ${sendRow.id}:`, err)
    }
  }
  // An event-email blast is marketing/bulk against the shared daily budget: it
  // must not be able to drain the sends reserved for transactional mail. A test
  // goes to the sender only and is always allowed through.
  const kind = isTest ? 'transactional' : 'marketing'
  let stoppedForQuota = false
  let stoppedForTime = false
  let stoppedForDeadline = false
  for (const [i, r] of recipients.entries()) {
    // Out of time for this run: stop BEFORE the function is killed, so the
    // run is recorded as finished with honest counts and can be continued.
    if (opts.deadline && Date.now() + (i > 0 ? opts.spacingMs ?? SEND_SPACING_MS : 0) > opts.deadline - DEADLINE_MARGIN_MS) {
      stoppedForDeadline = true
      break
    }
    if (i > 0) await sleep(opts.spacingMs ?? SEND_SPACING_MS)
    // The cron runner has moved on to the next tenant: stop rather than share the
    // account's send rate with it. Like a quota stop, the unreached recipients are
    // not recorded, so the next run sends them.
    if (opts.signal?.aborted) {
      stoppedForTime = true
      break
    }
    // Record the address as 'sending' BEFORE handing it to Resend. If the
    // function is killed between Resend accepting the message and the result
    // being saved, the address is already on the row, so a re-run skips it
    // (nobody is emailed twice) and History shows it as unconfirmed instead of
    // silently emailing it again (17 Nov 2026: one parent got the consent email
    // twice exactly this way).
    const base = { email: r.email, name: r.name, memberId: r.memberId ?? null, roles: r.roles }
    results.push({ ...base, status: 'sending' })
    await persistProgress()
    try {
      const content = renderEventEmail(email, { ...eventVars, ...recipientMergeVars(r) })
      const out = await sendEmail({
        to: r.email,
        from: opts.sender?.from ?? EVENT_EMAIL_FROM,
        replyTo: opts.sender?.replyTo ?? EVENT_EMAIL_REPLY_TO,
        subject: isTest ? `[TEST] ${content.subject}` : content.subject,
        html: content.html,
        text: content.text,
        attachments: opts.attachments,
        kind,
        tags: { feature: isTest ? 'event_email_test' : 'event_email', ref: email.id },
        // S5 B24: a tenant's mail, if queued, waits in the outbox as that tenant's.
        ...(isTenantRow(email.tenant_id) ? { tenantId: email.tenant_id } : {}),
      })
      // sendEmail does not throw for an address on our suppression list or for
      // mail parked in the outbox by the daily budget — record what really
      // happened instead of calling both 'sent'.
      const status = out?.suppressed ? 'suppressed' : out?.queued ? 'queued' : 'sent'
      results[results.length - 1] = { ...base, status, ...(out?.id ? { resendId: out.id } : {}) }
    } catch (err) {
      // deep review INT-2 / PUB-4: a quota/429 means the SHARED Resend budget is
      // spent, not that this recipient failed. STOP now and do NOT record this
      // recipient (nor anyone after), so the next run retries them —
      // alreadyTriedAddresses only skips addresses we actually persisted. A
      // genuine per-recipient failure (e.g. a bad address) still records as
      // 'failed' and carries on, exactly as before.
      if (err instanceof EmailSendError && err.isQuota) {
        results.pop()
        stoppedForQuota = true
        break
      }
      results[results.length - 1] = { ...base, status: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) }
    }
    await persistProgress()
    if (opts.onProgress) await opts.onProgress()
  }

  // 'queued' mail goes out from the outbox shortly, so it counts as sent here;
  // suppressed and failed recipients do not.
  const sent = results.filter((r) => r.status === 'sent' || r.status === 'queued').length
  const suppressed = results.filter((r) => r.status === 'suppressed').length
  const failed = results.filter((r) => r.status === 'failed').length
  // A run that stopped early (time, budget or its cron slice) also lists who it
  // did NOT reach, as 'not_reached'. They are not "tried" (alreadyTriedAddresses
  // skips them, so the next run emails them), but History can then tell
  // "still waiting" from "left the group before their turn" (a consent form
  // signed in between) by name, instead of only by a shrinking count.
  const notReached: EventEmailSendRow['recipients'] = recipients.slice(results.length)
    .map((r) => ({ email: r.email, name: r.name, memberId: r.memberId ?? null, roles: r.roles, status: 'not_reached' as const }))
  if (sendRow?.id) {
    await db
      .from('event_email_sends')
      .update({ sent_count: sent, failed_count: failed, recipients: [...results, ...notReached], finished_at: new Date().toISOString() })
      .eq('id', sendRow.id)
  }
  return { sendId: (sendRow?.id as string) ?? '', sent, failed, suppressed, reached: results.length, stoppedForQuota, stoppedForTime, stoppedForDeadline }
}

/**
 * deep review INT-1: re-drive event emails abandoned in 'sending' by a killed
 * function. Without this a scheduled send cut off at the 60s budget would stay
 * 'sending' forever — the admin PATCH refuses with 409 and the cron only picks
 * up 'scheduled' rows, so the recipients after the cut-off would never get it
 * and no catch-up would ever reach them. The resumed send skips addresses the
 * killed run already emailed (see sendEventEmail's alreadyTried subtraction),
 * so nobody is emailed twice. Called from the cron after the scheduled sends.
 */
export async function reclaimStuckSending(
  db: SupabaseClient,
  budgetLeft: () => boolean,
  /**
   * S5 B14: the cron's tenant. With it, only that tenant's rows are re-driven
   * (NULL tenant_id counts as Stellr's), with its sender. Without it, every row,
   * as before.
   */
  scope: { tenantId?: string; sender?: EventSender; signal?: AbortSignal; deadline?: number } = {},
): Promise<{ reclaimed: number; errors: { id: string; error: string }[] }> {
  const out = { reclaimed: 0, errors: [] as { id: string; error: string }[] }
  const stale = new Date(Date.now() - SENDING_STALE_MS).toISOString()
  const { data: rows, error } = await db
    .from('event_emails')
    .select(scope.tenantId ? 'id, tenant_id' : 'id')
    .eq('status', 'sending')
    .lt('updated_at', stale)
    .order('updated_at', { ascending: true })
  if (error) {
    out.errors.push({ id: 'query', error: error.message })
    return out
  }
  const tenantId = scope.tenantId
  const mine = ((rows ?? []) as unknown as { id: string; tenant_id?: string | null }[])
    .filter((row) => !tenantId || rowInTenant(row.tenant_id, tenantId))
  for (const row of mine) {
    if (!budgetLeft()) break
    const r = await sendEventEmail(db, row.id as string, {
      trigger: 'schedule',
      triggeredBy: 'resume',
      resume: true,
      ...(scope.sender ? { sender: scope.sender } : {}),
      ...(scope.signal ? { signal: scope.signal } : {}),
      ...(scope.deadline ? { deadline: scope.deadline } : {}),
    })
    // 409 just means another run took it first — not an error.
    if (r.ok) out.reclaimed++
    else if (r.status !== 409) out.errors.push({ id: row.id as string, error: r.error })
  }
  return out
}
