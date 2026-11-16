// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memberIdOf, verifiedEventAudit } from './audit-route-helpers'
import { noteAuditSubject } from './audit/route-subject'

const MEMBER = '33333333-3333-4333-8333-333333333333'

describe('memberIdOf', () => {
  it('reads the segment after /members/', () => {
    expect(memberIdOf(new Request(`https://app.test/api/admin/members/${MEMBER}/invite`))).toBe(MEMBER)
    expect(memberIdOf(new Request(`https://app.test/api/admin/members/${MEMBER}/memberships/abc`))).toBe(MEMBER)
  })

  it('is null when the path names no member', () => {
    expect(memberIdOf(new Request('https://app.test/api/admin/events/x'))).toBeNull()
    expect(memberIdOf(new Request('https://app.test/api/admin/members'))).toBeNull()
  })
})

describe('verifiedEventAudit', () => {
  it('puts the event on the chain of the slug the access check verified, not the URL slug', () => {
    const req = new Request('https://app.test/api/admin/events/Some-Other-Slug/awards', { method: 'PUT' })
    noteAuditSubject(req, { userId: 'user_placeholder', eventSlug: 'verified-2027', detail: { award_type: 'participation' } })
    expect(verifiedEventAudit(req, 'event_award_assignments')).toEqual({
      actor: { userId: 'user_placeholder' },
      tenant: { eventSlug: 'verified-2027' },
      target: { table: 'event_award_assignments', id: null },
      metadata: { event_slug: 'verified-2027', award_type: 'participation' },
    })
  })

  it('goes on the platform chain, reading the session, when no check passed', () => {
    const req = new Request('https://app.test/api/admin/events/tenant-event-2027/awards', { method: 'PUT' })
    expect(verifiedEventAudit(req, 'event_award_assignments')).toEqual({
      actor: { session: true },
      tenant: { tenantId: null },
      target: { table: 'event_award_assignments', id: null },
      metadata: {},
    })
  })
})
