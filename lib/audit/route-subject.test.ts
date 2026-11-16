// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adminAuditSubject, auditSubject, noteAuditSubject } from './route-subject'

const req = () => new Request('https://app.test/x', { method: 'POST' })

describe('noteAuditSubject', () => {
  it('a later note adds to the detail rather than replacing it', () => {
    const r = req()
    noteAuditSubject(r, { userId: 'user_a1', tenantId: 't', detail: { a: 1 } })
    noteAuditSubject(r, { detail: { b: 2 } })
    expect(auditSubject(r, 'things').metadata).toEqual({ a: 1, b: 2 })
  })
})

describe('adminAuditSubject', () => {
  it("with nothing noted: the session's user, Stellr's chain, no target id", () => {
    expect(adminAuditSubject(req(), 'members')).toEqual({
      actor: { session: true },
      tenant: { stellr: true },
      target: { table: 'members', id: null },
      metadata: {},
    })
  })

  it('a noted table, id and user replace the defaults', () => {
    const r = req()
    noteAuditSubject(r, { userId: 'user_a1', table: 'community_spaces', id: 'x-1', detail: { kind: 'space' } })
    expect(adminAuditSubject(r, 'mentoring_cohorts')).toEqual({
      actor: { userId: 'user_a1' },
      tenant: { stellr: true },
      target: { table: 'community_spaces', id: 'x-1' },
      metadata: { kind: 'space' },
    })
  })

  it('a verified slug picks the chain and is stored; an unverified one only picks the chain', () => {
    const verified = req()
    noteAuditSubject(verified, { eventSlug: 'event-2026' })
    expect(adminAuditSubject(verified, 'e')).toMatchObject({ tenant: { eventSlug: 'event-2026' }, metadata: { event_slug: 'event-2026' } })

    const unverified = req()
    noteAuditSubject(unverified, { chainSlug: 'from-the-url' })
    const s = adminAuditSubject(unverified, 'e')
    expect(s.tenant).toEqual({ eventSlug: 'from-the-url' })
    expect(s.metadata).toEqual({})
  })
})
