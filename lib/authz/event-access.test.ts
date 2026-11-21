// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// deep review TEST-2: the event gate is the only automated check on the admin event routes
// (proxy.ts covers pages, not /api/admin/*, and the server uses service_role so RLS never
// applies). Route tests replace it, so these pin the real lib/authz requireEventAccess: an
// event manager is refused an event they are not assigned to, a non-manager is refused.
//
// S5 C25 batch 4 (21 Nov 2026): lib/event-access.ts is deleted and every caller is on this
// one. Owner decision: Staff get the Competitions pages, so Staff reach every Stellr event
// here (isAdmin false). Before, the legacy form sent Staff away with 403. Event managers keep
// exactly their assigned events, admins every event, and nobody else gains anything.

const authMock = vi.fn()
let db: FakeDb
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))

import { requireEventAccess } from '@/lib/authz'

const em = { userId: 'u-em', sessionClaims: { metadata: { role: 'event_manager' } } }
const staff = { userId: 'u-staff', sessionClaims: { metadata: { role: 'staff' } }, factorVerificationAge: [0, 0] }

beforeEach(() => {
  db = fakeSupabase({ event_manager_assignments: [{ clerk_user_id: 'u-em', event_slug: 'colorado' }] })
  authMock.mockReset()
})

describe('requireEventAccess (lib/authz)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null })
    expect(await requireEventAccess('colorado')).toEqual({ ok: false, status: 401 })
  })

  it('lets an admin into any event, with assignedSlugs = null (every Stellr event)', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    expect(await requireEventAccess('nevada')).toEqual({ ok: true, userId: 'u-admin', isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    expect(await requireEventAccess()).toEqual({ ok: true, userId: 'u-admin', isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
  })

  it('lets an event manager into their own event', async () => {
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess('colorado')).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })
  })

  it('refuses an event manager on an event they are not assigned to', async () => {
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess('nevada')).toEqual({ ok: false, status: 403 })
  })

  it('refuses a member, a mentor, or anyone with no Clerk portal role', async () => {
    for (const role of ['member', 'mentor', 'student', undefined]) {
      authMock.mockResolvedValue({ userId: 'u', sessionClaims: { metadata: { role } } })
      expect(await requireEventAccess('colorado'), String(role)).toEqual({ ok: false, status: 403 })
      expect(await requireEventAccess(), String(role)).toEqual({ ok: false, status: 403 })
    }
  })

  it('lets Staff into every Stellr event, not as an admin (owner decision, 21 Nov 2026)', async () => {
    authMock.mockResolvedValue(staff)
    const want = { ok: true, userId: 'u-staff', isAdmin: false, assignedSlugs: null, tenantId: STELLR_TENANT_ID }
    expect(await requireEventAccess('colorado')).toEqual(want)
    expect(await requireEventAccess('nevada')).toEqual(want)
    expect(await requireEventAccess()).toEqual(want)
  })

  it('Staff needs no assignment, and none is read for them', async () => {
    // A read of the assignments would fail, so the answer shows none was made.
    db = fakeSupabase({}, { failOn: (table) => (table === 'event_manager_assignments' ? 'must not be read' : null) })
    authMock.mockResolvedValue(staff)
    expect(await requireEventAccess('nevada')).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: null })
    authMock.mockResolvedValue(em)
    await expect(requireEventAccess('nevada')).rejects.toThrow()
  })

  it('refuses Staff on a session with no second factor (staff-role.8)', async () => {
    authMock.mockResolvedValue({ ...staff, factorVerificationAge: [0, -1] })
    expect(await requireEventAccess('colorado')).toEqual({ ok: false, status: 403 })
  })

  it('list access (no slug) hands an event manager only the assigned slugs, never null (null = every event)', async () => {
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess()).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: ['colorado'] })
  })

  it('an expired assignment gives no access', async () => {
    db = fakeSupabase({ event_manager_assignments: [{ clerk_user_id: 'u-em', event_slug: 'colorado', expires_at: '2000-01-01T00:00:00Z' }] })
    authMock.mockResolvedValue(em)
    expect(await requireEventAccess('colorado')).toEqual({ ok: false, status: 403 })
  })
})
