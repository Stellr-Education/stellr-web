import { afterEach, describe, it, expect, vi } from 'vitest'

// lib/authz hasScope, which replaced lib/admin-auth currentUserHasScope (S5 C25 batch 4,
// 21 Nov 2026). It decides who hosts a live training room (lib/training.ts), for any member
// joining a class, so its truth table is pinned case by case: these are the legacy helper's
// tests (deep review TEST-2), with the same answers, now run on lib/authz under
// AUTHZ_SOURCE unset (the Clerk claim). A table-keyed fake drives the members ->
// admin_duties lookup.
const authMock = vi.fn()
const dbState: { member: { id: string } | null; scopes: string[] | null; fail: string | null } = { member: null, scopes: null, fail: null }
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => {
        if (dbState.fail === table) return { data: null, error: { message: 'down' } }
        return table === 'members'
          ? { data: dbState.member, error: null }
          : { data: dbState.scopes == null ? null : { scopes: dbState.scopes }, error: null }
      }
      return chain
    },
  }),
}))

import { hasScope, isStellrAdmin, portalRoleFromClaims } from '@/lib/authz'

afterEach(() => {
  authMock.mockReset()
  dbState.member = null
  dbState.scopes = null
  dbState.fail = null
})

describe('portalRoleFromClaims (replaced isAdminClaims, isEventManagerClaims, hasAdminPortalAccess)', () => {
  it('is admin only for metadata.role === "admin"', () => {
    expect(portalRoleFromClaims({ metadata: { role: 'admin' } })).toBe('admin')
    for (const c of [{ metadata: { role: 'Admin' } }, { metadata: {} }, {}, null, undefined]) {
      expect(portalRoleFromClaims(c as Record<string, unknown> | null | undefined), JSON.stringify(c)).toBe(null)
    }
  })

  it('event managers and Staff get the portal shell but are not admins', () => {
    expect(portalRoleFromClaims({ metadata: { role: 'event_manager' } })).toBe('event_manager')
    expect(portalRoleFromClaims({ metadata: { role: 'staff' } })).toBe('staff')
    expect(portalRoleFromClaims({ metadata: { role: 'member' } })).toBe(null)
  })
})

describe('isStellrAdmin (replaced currentUserIsAdmin)', () => {
  it('reads the session and applies the same rule', async () => {
    authMock.mockResolvedValueOnce({ userId: 'u1', sessionClaims: { metadata: { role: 'admin' } } })
    expect(await isStellrAdmin()).toBe(true)
    authMock.mockResolvedValueOnce({ userId: 'u2', sessionClaims: { metadata: { role: 'member' } } })
    expect(await isStellrAdmin()).toBe(false)
    authMock.mockResolvedValueOnce({ userId: null, sessionClaims: null })
    expect(await isStellrAdmin()).toBe(false)
  })
})

describe('hasScope (replaced currentUserHasScope)', () => {
  it('refuses when there is no session', async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null })
    expect(await hasScope('events')).toBe(false)
  })

  it('grants every scope to an admin without reading admin_duties', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    dbState.fail = 'members'
    expect(await hasScope('graduations')).toBe(true)
    expect(await hasScope('community')).toBe(true)
  })

  it('refuses a signed-in non-admin with no member row', async () => {
    authMock.mockResolvedValue({ userId: 'u-x', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = null
    expect(await hasScope('events')).toBe(false)
  })

  it('refuses a member whose admin_duties row lacks the scope', async () => {
    authMock.mockResolvedValue({ userId: 'u-duty', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = ['community']
    expect(await hasScope('events')).toBe(false)
  })

  it('grants a member holding the exact scope, or the "all" scope', async () => {
    authMock.mockResolvedValue({ userId: 'u-duty', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = ['events']
    expect(await hasScope('events')).toBe(true)
    dbState.scopes = ['all']
    expect(await hasScope('graduations')).toBe(true)
  })

  it('refuses a member with no admin_duties row at all', async () => {
    authMock.mockResolvedValue({ userId: 'u-duty', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = null
    expect(await hasScope('events')).toBe(false)
  })

  it('a read error is no scope, as before: never a host by accident', async () => {
    authMock.mockResolvedValue({ userId: 'u-duty', sessionClaims: { metadata: { role: 'member' } } })
    dbState.member = { id: 'm-1' }
    dbState.scopes = ['community']
    dbState.fail = 'members'
    expect(await hasScope('community')).toBe(false)
    dbState.fail = 'admin_duties'
    expect(await hasScope('community')).toBe(false)
  })

  it('Staff and event managers hold no scope by their role: only an admin_duties row grants one', async () => {
    for (const role of ['staff', 'event_manager']) {
      authMock.mockResolvedValue({ userId: 'u', sessionClaims: { metadata: { role } }, factorVerificationAge: [0, 0] })
      dbState.member = { id: 'm-1' }
      dbState.scopes = null
      expect(await hasScope('community'), role).toBe(false)
      dbState.scopes = ['community']
      expect(await hasScope('community'), role).toBe(true)
    }
  })
})
