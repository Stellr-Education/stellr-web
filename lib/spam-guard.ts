// Behavioural spam signals for the public forms: the honeypot and the timing
// trap (docs/REC-form-spam-hardening.md §3, layer L1b).
//
// The per-IP rate limit (lib/rate-limit.ts) stops one machine hammering one
// route. It does nothing about a botnet that posts once per residential IP,
// which is what form spam mostly is. These two signals key on behaviour
// instead: a generic form-filler fills every input it finds, including one no
// person can see, and it submits the moment the page loads.
//
// Honest limits: both fields come from the browser, so a bot tuned against
// these forms can clear the honeypot and forge the timestamps. This is cheap
// volume reduction, not a wall. Turnstile (L2) is the layer for the tuned case.
//
// The client half is components/forms/useSpamGuard.ts, which imports the
// field names and limits below. Keep this module free of server-only imports so
// that stays possible.

import { isProd } from '@/lib/env'

/** The honeypot field. A name bots want to fill, and no public form uses it. */
export const HONEYPOT_FIELD = 'website'
/** Epoch ms at which the form mounted, on the browser's clock. */
export const RENDERED_AT_FIELD = 'renderedAt'
/**
 * Epoch ms at which the visitor pressed submit, on the same browser clock.
 * Measuring the dwell as submittedAt − renderedAt keeps a browser whose clock
 * is minutes off from reading as "instant" and losing a real submission. The
 * staleness check still runs on the server's clock (see CLOCK_SKEW_MS). A body
 * without it falls back to the server's clock for both.
 */
export const SUBMITTED_AT_FIELD = 'submittedAt'

/** Faster than this from mount to submit is a bot. */
export const MIN_DWELL_MS = 3_000
/** Slower than this is a stale page or a replayed request. */
export const MAX_DWELL_MS = 6 * 60 * 60 * 1000
/**
 * How far the browser's clock may sit from the server's. submittedAt must fall
 * within this of the server's now, which also bounds renderedAt to no older
 * than MAX_DWELL_MS + CLOCK_SKEW_MS and no further ahead than CLOCK_SKEW_MS.
 * Without it a captured real body (its dwell a plausible 5–60 s) would replay
 * forever. A browser clock more than this far off has its submissions dropped
 * in production; an hour covers ordinary drift, not a wrong time zone.
 */
export const CLOCK_SKEW_MS = 60 * 60 * 1000

const SPAM_FIELDS = [HONEYPOT_FIELD, RENDERED_AT_FIELD, SUBMITTED_AT_FIELD] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function filled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  return String(v).trim() !== ''
}

/** A positive epoch-ms number, from a number or a numeric string; else null. */
function epochMs(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The answer a tripped trap gets. A 400 would teach the bot to retry with the
 * field cleared; a 200 tells it nothing. The log carries the route name only:
 * no IP and nothing from the body.
 */
function silentAccept(signal: 'honeypot' | 'timing', route: string): Response {
  console.warn(`[spam] ${signal}`, route)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * The timing trap. The floor and ceiling are on the dwell, measured on the
 * browser's own clock when it sent submittedAt. Staleness is on the server's
 * clock: a submittedAt further than CLOCK_SKEW_MS from now is a replay or a
 * forgery, however plausible its dwell.
 */
function timingTripped(renderedAt: number, submittedAt: number | null, now: number): boolean {
  const dwell = (submittedAt ?? now) - renderedAt
  if (dwell < MIN_DWELL_MS || dwell > MAX_DWELL_MS) return true
  if (submittedAt !== null && Math.abs(now - submittedAt) > CLOCK_SKEW_MS) return true
  return false
}

export interface SpamCheckOptions {
  /**
   * false: the honeypot only. For a form a real person fills in seconds, or
   * opens already filled, where the timing trap would drop real submissions:
   * check-in at the door, reached from a QR code. Any timing fields sent are
   * still stripped, and nothing is logged for their absence. Default true.
   */
  timing?: boolean
}

/**
 * Check one submission's spam signals. Returns a ready-to-return silent 200
 * when a trap tripped, or null to carry on. Either way the honeypot and timing
 * fields are removed from `body`, so nothing after this call can store or send
 * them.
 *
 * Call it after the rate limit and the route's zod parse, on the raw parsed
 * JSON. `req` is unused until Turnstile (L2) needs the client IP; it is in the
 * signature now so routes do not change again then.
 *
 * A body with no usable `renderedAt` is accepted, with a warning: pages cached
 * before this shipped, and open tabs running the previous bundle, send none.
 */
export function checkSpamSignals(
  body: unknown,
  req: Request,
  routeName: string,
  options: SpamCheckOptions = {}
): Response | null {
  void req
  if (!isRecord(body)) return null

  const website = body[HONEYPOT_FIELD]
  const renderedAt = epochMs(body[RENDERED_AT_FIELD])
  const submittedAt = epochMs(body[SUBMITTED_AT_FIELD])
  for (const key of SPAM_FIELDS) delete body[key]

  if (filled(website)) return silentAccept('honeypot', routeName)
  if (options.timing === false) return null

  if (renderedAt === null) {
    console.warn('[spam] no-timing', routeName)
    return null
  }

  if (!timingTripped(renderedAt, submittedAt, Date.now())) return null

  // Enforced in production only. Everywhere else the e2e suite drives these
  // forms, and a test browser is a fast form-filler by design: it would trip
  // the trap, get the silent 200 and leave nothing behind for the test to
  // find. Outside production the trip is logged and the submission goes
  // through. The honeypot is enforced everywhere; no test fills it.
  if (!isProd()) {
    console.warn('[spam] timing (not enforced outside production)', routeName)
    return null
  }
  return silentAccept('timing', routeName)
}
