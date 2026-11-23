// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupportSession } from '@/lib/authz/support-session'

// The seam S6-SUP fills in. Mocked here to open a session; the real one is checked below.
const session = vi.hoisted(() => ({ current: null as SupportSession | null }))
vi.mock('@/lib/authz/support-session', () => ({ supportSessionOf: () => session.current }))

const { assertWritable, isAdminApiRequest, ReadOnlySupportSessionError, SupportWriteRefusedError, writeRefusal } = await import('@/lib/authz/writable')
const { withAudit } = await import('@/lib/audit/route')
const real = await vi.importActual<typeof import('@/lib/authz/support-session')>('@/lib/authz/support-session')

const SPEC = { action: 'event.access.sync', actor: { session: true }, tenant: { stellr: true } } as const
const req = (path: string) => new Request(`https://www.example.test${path}`, { method: 'POST' })

/** A withAudit route as the app writes one, with recording off so no database is touched. */
function route() {
  const handler = vi.fn(async (_req?: Request) => new Response('done', { status: 200 }))
  return { handler, POST: withAudit(SPEC, handler, { enabled: false }) }
}

afterEach(() => {
  session.current = null
})

describe('supportSessionOf (the real seam, before S6-SUP)', () => {
  it('answers null with no principal, as withAudit calls it, and for a normal principal', () => {
    expect(real.supportSessionOf()).toBeNull()
    expect(real.supportSessionOf(null)).toBeNull()
    expect(real.supportSessionOf({ mode: 'normal' })).toBeNull()
  })
  it('reads a support_read principal as a read session', () => {
    expect(real.supportSessionOf({ mode: 'support_read' })).toEqual({ mode: 'read' })
  })
})

describe('assertWritable', () => {
  it('passes with no support session', () => {
    expect(() => assertWritable()).not.toThrow()
    expect(writeRefusal(req('/api/admin/members'))).toBeNull()
  })

  it('refuses a read session with a typed 403', () => {
    session.current = { mode: 'read' }
    expect(() => assertWritable()).toThrow(ReadOnlySupportSessionError)
    try {
      assertWritable()
    } catch (err) {
      expect(err).toMatchObject({ status: 403, code: 'support_read_only' })
    }
  })

  it('refuses break-glass unless the route opted in (S6-BG)', () => {
    session.current = { mode: 'break_glass' }
    expect(() => assertWritable()).toThrow(SupportWriteRefusedError)
    expect(() => assertWritable()).toThrow(expect.objectContaining({ status: 403, code: 'break_glass_unsupported' }))
    expect(() => assertWritable(null, undefined, { breakGlass: true })).not.toThrow()
  })

  it('refuses an ended session of either mode, opted in or not (S6-BG time limit)', () => {
    for (const mode of ['read', 'break_glass'] as const) {
      session.current = { mode, ended: true }
      expect(() => assertWritable(null, undefined, { breakGlass: true })).toThrow(expect.objectContaining({ code: 'support_session_ended' }))
    }
  })
})

describe('withAudit enforces it on the admin API', () => {
  it('no session: the admin handler runs', async () => {
    const { handler, POST } = route()
    const res = await POST(req('/api/admin/members'))
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('read session: 403 support_read_only, and the handler never runs', async () => {
    session.current = { mode: 'read' }
    const { handler, POST } = route()
    const res = await POST(req('/api/admin/events/x/registrations'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden', code: 'support_read_only' })
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['/api/cron/email-reminders', '/api/webhooks/stripe', '/api/register'])('read session: %s is not the admin API and runs', async (path) => {
    session.current = { mode: 'read' }
    const { handler, POST } = route()
    expect((await POST(req(path))).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('read session with no readable request fails closed', async () => {
    session.current = { mode: 'read' }
    const { handler, POST } = route()
    expect((await POST()).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('isAdminApiRequest', () => {
  it('matches /api/admin and below only', () => {
    expect(isAdminApiRequest(req('/api/admin'))).toBe(true)
    expect(isAdminApiRequest(req('/api/admin/x?y=1'))).toBe(true)
    expect(isAdminApiRequest(req('/api/administrator'))).toBe(false)
    expect(isAdminApiRequest(req('/admin/events'))).toBe(false)
    expect(isAdminApiRequest({ url: 42 })).toBe(true)
  })
})
