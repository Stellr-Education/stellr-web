/**
 * lib/authz/support-session.ts — the support-session seam (S6-AW, made real by S6-SUP).
 *
 * S6 support mode (docs/S6-DESIGN.md section 2) lets a platform admin look into one
 * non-owner tenant, read-only, for 60 minutes or less. Opening one
 * (app/api/admin/support/session) writes a public.support_sessions row and sets a
 * signed cookie; this module reads that cookie.
 *
 * Off unless SUPPORT_MODE_ENABLED is exactly 'true'. Off, supportSessionOf() answers
 * from the principal alone and never touches the request: it sits on the hot path of
 * every audited mutation (withAudit, lib/audit/route.ts), and Active CPU is metered.
 *
 * Two readings, for two jobs:
 *   - supportSessionOf(principal, req): synchronous, no database, no Clerk. It checks
 *     the cookie's signature and expiry only, and is used to REFUSE writes
 *     (lib/authz/writable.ts). Trusting a validly signed cookie that much can only
 *     refuse more: a forged or expired one is no session, so its holder keeps the
 *     access they already had, and nothing here grants anything.
 *   - loadSupportSession() (lib/authz/support-session-server.ts): the full check,
 *     needed before anything is READ under a session: the cookie, its binding to the
 *     caller's Clerk user and Clerk session id, and the support_sessions row (open,
 *     not expired, same admin, tenant and mode).
 *
 * The cookie is signed with its own secret, SUPPORT_SESSION_SECRET (at least 32
 * characters, and not a copy of IMPERSONATION_SECRET, CLERK_SECRET_KEY or
 * CRON_SECRET). Kept free of 'server-only', Clerk and the database, because
 * lib/audit/route.ts imports it through lib/authz/writable.ts.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { Principal } from '@/lib/authz/decide'

/** The environment flag. Anything but exactly 'true' is off. */
export const SUPPORT_MODE_FLAG = 'SUPPORT_MODE_ENABLED'
/** The cookie's signing secret. Its own value, used for nothing else. */
export const SUPPORT_SESSION_SECRET_ENV = 'SUPPORT_SESSION_SECRET'
/** The cookie that carries a support session. httpOnly, SameSite=Strict. */
export const SUPPORT_SESSION_COOKIE = 'stellr_support_session'
/** The longest a session may run; the database CHECK holds the same limit. */
export const SUPPORT_SESSION_MAX_MINUTES = 60
/** The floor for the repo's HMAC secrets. */
export const SUPPORT_SECRET_MIN_LENGTH = 32

/** 'read' refuses every admin mutation; 'break_glass' is S6-BG's time-limited write. */
export type SupportSessionMode = 'read' | 'break_glass'

export interface SupportSession {
  mode: SupportSessionMode
  /** support_sessions.id. Absent only for a principal marked support_read. */
  sessionId?: string
  tenantId?: string
  /** Epoch milliseconds. */
  endsAt?: number
  /**
   * S6-BG: the cookie is validly signed but its end time has passed. Such a session
   * grants nothing and refuses every admin write (lib/authz/writable.ts), so a session
   * past its time limit cannot write even if the browser still sends the cookie.
   */
  ended?: boolean
}

/** What the cookie carries, signed. */
export interface SupportTicket {
  v: 1
  /** support_sessions.id */
  sid: string
  /** The tenant the session reads. */
  tid: string
  /** The platform admin's Clerk user id. */
  uid: string
  /** The Clerk session id the ticket is bound to. */
  csid: string
  mode: SupportSessionMode
  /** Epoch milliseconds: the session's ends_at. */
  exp: number
}

type Env = Record<string, string | undefined>

/** Whether support mode is on. Read per call, so a test or a redeploy changes it. */
export function supportModeEnabled(env: Env = process.env): boolean {
  return env[SUPPORT_MODE_FLAG] === 'true'
}

/** Why SUPPORT_SESSION_SECRET cannot be used, as fixed text naming the variable, or null. Never the value. */
export function supportSecretProblem(env: Env = process.env): string | null {
  const key = env[SUPPORT_SESSION_SECRET_ENV]
  if (!key) return `${SUPPORT_SESSION_SECRET_ENV} is not set`
  if (key.length < SUPPORT_SECRET_MIN_LENGTH) return `${SUPPORT_SESSION_SECRET_ENV} is shorter than ${SUPPORT_SECRET_MIN_LENGTH} characters`
  if (key === env.IMPERSONATION_SECRET || key === env.CLERK_SECRET_KEY || key === env.CRON_SECRET) {
    return `${SUPPORT_SESSION_SECRET_ENV} is a copy of another secret`
  }
  return null
}

function secret(env: Env): string | null {
  return supportSecretProblem(env) === null ? (env[SUPPORT_SESSION_SECRET_ENV] as string) : null
}

// Domain separation: the same key could never sign anything else's payload into a ticket.
const sign = (key: string, payload: string) => createHmac('sha256', key).update(`stellr-support-v1.${payload}`).digest('base64url')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLERK_USER = /^user_[A-Za-z0-9]{1,64}$/
const CLERK_SESSION = /^sess_[A-Za-z0-9]{1,64}$/

function isTicket(t: unknown): t is SupportTicket {
  const o = t as Partial<SupportTicket> | null
  return (
    !!o &&
    o.v === 1 &&
    typeof o.sid === 'string' && UUID.test(o.sid) &&
    typeof o.tid === 'string' && UUID.test(o.tid) &&
    typeof o.uid === 'string' && CLERK_USER.test(o.uid) &&
    typeof o.csid === 'string' && CLERK_SESSION.test(o.csid) &&
    (o.mode === 'read' || o.mode === 'break_glass') &&
    typeof o.exp === 'number' && Number.isFinite(o.exp)
  )
}

/** Sign a ticket as `<base64url payload>.<signature>`. Throws when the secret is unusable or the ticket malformed. */
export function encodeSupportTicket(ticket: SupportTicket, env: Env = process.env): string {
  const key = secret(env)
  if (!key) throw new Error(`Support mode cannot sign a session: ${supportSecretProblem(env)}`)
  if (!isTicket(ticket)) throw new Error('A support ticket needs a session, tenant, Clerk user, Clerk session, mode and end time.')
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  return `${payload}.${sign(key, payload)}`
}

/**
 * The ticket in a cookie value, or null: a bad signature, bad JSON, a malformed field,
 * an expired ticket (unless `allowExpired`, which only the write refusal uses), or no
 * usable secret. Never throws.
 */
export function decodeSupportTicket(
  raw: string | undefined | null,
  env: Env = process.env,
  now: number = Date.now(),
  opts: { allowExpired?: boolean } = {},
): SupportTicket | null {
  try {
    if (!raw) return null
    const key = secret(env)
    if (!key) return null
    const idx = raw.lastIndexOf('.')
    if (idx <= 0) return null
    const payload = raw.slice(0, idx)
    const given = Buffer.from(raw.slice(idx + 1))
    const expected = Buffer.from(sign(key, payload))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
    const ticket: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!isTicket(ticket)) return null
    if (ticket.exp <= now && !opts.allowExpired) return null
    return ticket
  } catch {
    return null
  }
}

/** One cookie's value from a Cookie header, or null. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null
  }
  return null
}

/** The Cookie header of a Request-like value, or null for anything else. */
function cookieHeader(req: unknown): string | null {
  try {
    const headers = (req as { headers?: { get?: (n: string) => string | null } } | null | undefined)?.headers
    return typeof headers?.get === 'function' ? headers.get('cookie') : null
  } catch {
    return null
  }
}

/**
 * The support session this request runs under, or null. Synchronous and database-free:
 * used to refuse writes, never to grant a read (see the file header).
 *
 * A principal marked support_read answers 'read' (S6-AW). Otherwise, with the flag off,
 * null at once, without reading the request. With it on, a validly signed support
 * cookie on `req` answers its mode; one past its end time is marked `ended` (S6-BG).
 */
export function supportSessionOf(principal?: Pick<Principal, 'mode'> | null, req?: unknown): SupportSession | null {
  if (principal?.mode === 'support_read') return { mode: 'read' }
  if (!supportModeEnabled()) return null
  if (req === undefined || req === null) return null
  const now = Date.now()
  const ticket = decodeSupportTicket(cookieValue(cookieHeader(req), SUPPORT_SESSION_COOKIE), process.env, now, { allowExpired: true })
  if (!ticket) return null
  const session: SupportSession = { mode: ticket.mode, sessionId: ticket.sid, tenantId: ticket.tid, endsAt: ticket.exp }
  return ticket.exp <= now ? { ...session, ended: true } : session
}
