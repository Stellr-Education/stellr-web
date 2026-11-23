// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cookieValue,
  decodeSupportTicket,
  encodeSupportTicket,
  SUPPORT_SESSION_COOKIE,
  supportSecretProblem,
  supportSessionOf,
  type SupportTicket,
} from '@/lib/authz/support-session'
import { withAudit } from '@/lib/audit/route'

// S6-SUP: the seam withAudit's write refusal reads. Off, it does no work; on, a validly
// signed, unexpired support cookie is the session, and a read session makes every admin
// mutation 403 before its handler runs.

const SECRET = 'support-secret-for-tests-only-0123456789'
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)
const ticket = (over: Partial<SupportTicket> = {}): SupportTicket => ({
  v: 1,
  sid: '5e550000-0000-4000-8000-00000000000a',
  tid: '5e550000-0000-4000-8000-0000000000b2',
  uid: 'user_platformAdmin1',
  csid: 'sess_abc123',
  mode: 'read',
  exp: NOW + 30 * 60_000,
  ...over,
})

/** A request whose cookie header is counted, so "no work" can be seen. */
function req(path: string, cookie?: string) {
  const r = new Request(`https://www.example.test${path}`, { method: 'POST', headers: cookie ? { cookie } : {} })
  const get = vi.spyOn(r.headers, 'get')
  return { r, get }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('SUPPORT_MODE_ENABLED', undefined)
  vi.stubEnv('SUPPORT_SESSION_SECRET', SECRET)
  vi.stubEnv('IMPERSONATION_SECRET', undefined)
  vi.stubEnv('CLERK_SECRET_KEY', undefined)
  vi.stubEnv('CRON_SECRET', undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('supportSessionOf: flag off', () => {
  it('answers null without reading the request, even with a valid cookie on it', () => {
    const { r, get } = req('/api/admin/x', `${SUPPORT_SESSION_COOKIE}=${encodeSupportTicket(ticket())}`)
    expect(supportSessionOf(undefined, r)).toBeNull()
    expect(supportSessionOf(null, r)).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
  it('still reads a support_read principal as a read session (S6-AW)', () => {
    expect(supportSessionOf({ mode: 'support_read' })).toEqual({ mode: 'read' })
    expect(supportSessionOf({ mode: 'normal' })).toBeNull()
  })
})

describe('supportSessionOf: flag on', () => {
  beforeEach(() => vi.stubEnv('SUPPORT_MODE_ENABLED', 'true'))

  it('a valid cookie is the session', () => {
    const { r } = req('/api/admin/x', `a=1; ${SUPPORT_SESSION_COOKIE}=${encodeSupportTicket(ticket())}; b=2`)
    expect(supportSessionOf(undefined, r)).toEqual({
      mode: 'read',
      sessionId: ticket().sid,
      tenantId: ticket().tid,
      endsAt: ticket().exp,
    })
  })

  it('no request, no cookie, or a request-shaped value without headers: null', () => {
    expect(supportSessionOf()).toBeNull()
    expect(supportSessionOf(undefined, req('/api/admin/x').r)).toBeNull()
    expect(supportSessionOf(undefined, { url: '/api/admin/x' })).toBeNull()
  })

  it('an expired ticket is an ended session (S6-BG): it grants nothing, and refuses every admin write', () => {
    const raw = encodeSupportTicket(ticket({ exp: NOW - 1 }))
    expect(supportSessionOf(undefined, req('/', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)).toMatchObject({ ended: true })
    // decodeSupportTicket, which reads use, still answers no ticket at all.
    expect(decodeSupportTicket(raw)).toBeNull()
    expect(decodeSupportTicket(raw, process.env, NOW, { allowExpired: true })).not.toBeNull()
  })

  it('a forged or tampered ticket is no session', () => {
    const raw = encodeSupportTicket(ticket())
    const [payload, sig] = raw.split('.')
    const otherTenant = Buffer.from(JSON.stringify(ticket({ tid: '5e550000-0000-4000-8000-0000000000c3' }))).toString('base64url')
    for (const bad of [`${otherTenant}.${sig}`, `${payload}.${sig.slice(0, -2)}xx`, `${payload}.`, payload, 'x.y', '']) {
      expect(supportSessionOf(undefined, req('/', `${SUPPORT_SESSION_COOKIE}=${bad}`).r), bad).toBeNull()
    }
    vi.stubEnv('SUPPORT_SESSION_SECRET', 'another-secret-entirely-0123456789abcdef')
    expect(supportSessionOf(undefined, req('/', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)).toBeNull()
  })

  it('with no usable secret nothing verifies', () => {
    const raw = encodeSupportTicket(ticket())
    vi.stubEnv('SUPPORT_SESSION_SECRET', 'short')
    expect(supportSessionOf(undefined, req('/', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)).toBeNull()
  })
})

describe('the ticket', () => {
  it('refuses to sign without a usable secret, or a malformed ticket', () => {
    vi.stubEnv('SUPPORT_SESSION_SECRET', undefined)
    expect(() => encodeSupportTicket(ticket())).toThrow(/SUPPORT_SESSION_SECRET is not set/)
    vi.stubEnv('SUPPORT_SESSION_SECRET', SECRET)
    expect(() => encodeSupportTicket(ticket({ uid: 'not-a-clerk-user' }))).toThrow()
    expect(() => encodeSupportTicket(ticket({ mode: 'write' as never }))).toThrow()
  })

  it('a secret that copies another is refused, and the problem never echoes the value', () => {
    vi.stubEnv('IMPERSONATION_SECRET', SECRET)
    expect(supportSecretProblem()).toBe('SUPPORT_SESSION_SECRET is a copy of another secret')
    expect(decodeSupportTicket('x.y')).toBeNull()
  })

  it('round-trips', () => {
    expect(decodeSupportTicket(encodeSupportTicket(ticket()))).toEqual(ticket())
  })

  it('cookieValue reads one cookie by exact name', () => {
    expect(cookieValue('a=1; stellr_support_session=v.s; b=2', SUPPORT_SESSION_COOKIE)).toBe('v.s')
    expect(cookieValue('xstellr_support_session=v', SUPPORT_SESSION_COOKIE)).toBeNull()
    expect(cookieValue(null, SUPPORT_SESSION_COOKIE)).toBeNull()
  })
})

describe('end to end through withAudit: a read session refuses every admin mutation', () => {
  const SPEC = { action: 'event.access.sync', actor: { session: true }, tenant: { stellr: true } } as const
  const route = () => {
    const handler = vi.fn(async (_req?: Request) => new Response('done', { status: 200 }))
    return { handler, POST: withAudit(SPEC, handler, { enabled: false }) }
  }

  it('flag on, read cookie: 403 support_read_only and the handler never runs', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const { handler, POST } = route()
    const res = await POST(req('/api/admin/events/x/registrations', `${SUPPORT_SESSION_COOKIE}=${encodeSupportTicket(ticket())}`).r)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden', code: 'support_read_only' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('flag on, read cookie, not the admin API: runs', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const { handler, POST } = route()
    expect((await POST(req('/api/register', `${SUPPORT_SESSION_COOKIE}=${encodeSupportTicket(ticket())}`).r)).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('flag on, break-glass cookie, a route that has not opted in: 403 break_glass_unsupported (S6-BG)', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const { handler, POST } = route()
    const raw = encodeSupportTicket(ticket({ mode: 'break_glass' }))
    const res = await POST(req('/api/admin/members', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden', code: 'break_glass_unsupported' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('flag on, break-glass cookie, a route that opted in: runs, and the event goes on the session tenant naming the session', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const rpc = vi.fn(async () => ({ data: { id: 1, chain_seq: 1 }, error: null }))
    const db = { rpc, from: vi.fn() } as never
    const handler = vi.fn(async (_req?: Request) => new Response('done', { status: 200 }))
    const POST = withAudit(SPEC, handler, { enabled: true, afterResponse: false, db, breakGlass: true })
    const raw = encodeSupportTicket(ticket({ mode: 'break_glass' }))
    expect((await POST(req('/api/admin/members', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith(
      'platform_audit_append',
      expect.objectContaining({ p_tenant: ticket().tid, p_reason: 'break_glass', p_metadata: expect.objectContaining({ status: 200, support_session: ticket().sid }) }),
    )
  })

  it.each(['read', 'break_glass'] as const)('flag on, a %s cookie past its end time: 403 support_session_ended, even where break-glass is allowed', async (mode) => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const handler = vi.fn(async (_req?: Request) => new Response('done', { status: 200 }))
    const POST = withAudit(SPEC, handler, { enabled: false, breakGlass: true })
    const raw = encodeSupportTicket(ticket({ mode, exp: NOW - 1 }))
    const res = await POST(req('/api/admin/members', `${SUPPORT_SESSION_COOKIE}=${raw}`).r)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden', code: 'support_session_ended' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('flag off, the same cookie: runs, and the cookie is never read', async () => {
    const { handler, POST } = route()
    const { r, get } = req('/api/admin/members', `${SUPPORT_SESSION_COOKIE}=${encodeSupportTicket(ticket())}`)
    expect((await POST(r)).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
    expect(get).not.toHaveBeenCalled()
  })

  it('flag on, a forged cookie: runs (it grants nothing, and refuses nothing)', async () => {
    vi.stubEnv('SUPPORT_MODE_ENABLED', 'true')
    const { handler, POST } = route()
    expect((await POST(req('/api/admin/members', `${SUPPORT_SESSION_COOKIE}=forged.value`).r)).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })
})
