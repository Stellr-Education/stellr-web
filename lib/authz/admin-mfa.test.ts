/**
 * F4 part B: with ADMIN_MFA_ENFORCE=true an admin on a session with no second
 * factor loses the admin role in every lib/authz decision, and the admin pages
 * send it to ADMIN_MFA_PAGE. Off (the default) nothing changes and no Clerk
 * account read is made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeDb, MEMBER } from '@/test/fixtures/authz-principal'

const getUser = vi.fn(async (_id: string) => ({ twoFactorEnabled: false }))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: async () => ({ users: { getUser } }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import * as authz from '@/lib/authz'
import { ADMIN_MFA_PAGE, adminMfaEnforced, holdsAdminRole, withoutAdmin } from './admin-mfa'
import type { Principal } from './decide'

let n = 0
function signIn(role: string, factorVerificationAge: unknown, memberships: { tenant_id: string; role: string }[] = []) {
  const userId = `user_admin_mfa_${++n}`
  const db = fakeDb({
    members: [{ id: MEMBER, clerk_user_id: userId }],
    tenant_memberships: memberships.map((m) => ({ clerk_user_id: userId, member_id: null, ...m })),
  })
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(auth).mockResolvedValue({ userId, sessionClaims: { metadata: { role } }, factorVerificationAge } as never)
  return userId
}

const base: Principal = { userId: 'u', claimsRole: undefined, memberId: 'm', platformAdmin: false, memberships: [], mode: 'normal' }

describe('pure pieces', () => {
  it('reads the flag as exactly "true"', () => {
    expect(adminMfaEnforced({})).toBe(false)
    expect(adminMfaEnforced({ ADMIN_MFA_ENFORCE: 'TRUE' })).toBe(false)
    expect(adminMfaEnforced({ ADMIN_MFA_ENFORCE: '1' })).toBe(false)
    expect(adminMfaEnforced({ ADMIN_MFA_ENFORCE: 'true' })).toBe(true)
  })

  it('holdsAdminRole: the claim, platform_admins or a tenant_admin membership', () => {
    expect(holdsAdminRole(base)).toBe(false)
    expect(holdsAdminRole({ ...base, claimsRole: 'staff' })).toBe(false)
    expect(holdsAdminRole({ ...base, claimsRole: 'admin' })).toBe(true)
    expect(holdsAdminRole({ ...base, platformAdmin: true })).toBe(true)
    expect(holdsAdminRole({ ...base, memberships: [{ tenantId: 'x', role: 'tenant_admin' }] })).toBe(true)
    expect(holdsAdminRole({ ...base, userId: null, claimsRole: 'admin' })).toBe(false)
  })

  it('withoutAdmin strips every admin role and keeps the rest', () => {
    const p: Principal = {
      ...base,
      claimsRole: 'admin',
      platformAdmin: true,
      memberships: [
        { tenantId: STELLR_TENANT_ID, role: 'tenant_admin' },
        { tenantId: STELLR_TENANT_ID, role: 'event_manager' },
      ],
    }
    expect(withoutAdmin(p)).toEqual({ ...base, claimsRole: undefined, platformAdmin: false, memberships: [{ tenantId: STELLR_TENANT_ID, role: 'event_manager' }] })
    const staff = { ...base, claimsRole: 'staff' }
    expect(withoutAdmin(staff)).toBe(staff)
  })
})

describe('lib/authz with the gate', () => {
  beforeEach(() => {
    getUser.mockClear()
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flag off: an admin with no second factor keeps everything, with no Clerk read', async () => {
    signIn('admin', [5, -1])
    expect(await authz.isStellrAdmin()).toBe(true)
    expect(await authz.requireCapability('impersonate')).toEqual({ ok: true, via: 'admin' })
    expect(await authz.adminNeedsSecondFactor()).toBe(false)
    await expect(authz.page.requireStellrAdmin()).resolves.toBeUndefined()
    expect(getUser).not.toHaveBeenCalled()
  })

  it('flag on, second factor on the session: an admin keeps everything', async () => {
    vi.stubEnv('ADMIN_MFA_ENFORCE', 'true')
    signIn('admin', [5, 5])
    expect(await authz.isStellrAdmin()).toBe(true)
    expect(await authz.hasPortalAccess()).toBe(true)
    expect(await authz.adminNeedsSecondFactor()).toBe(false)
    await expect(authz.page.requireAdmin()).resolves.toBeUndefined()
    expect(getUser).not.toHaveBeenCalled()
  })

  it('flag on, no second factor: refused by every decision, and the pages redirect to the two-step page', async () => {
    vi.stubEnv('ADMIN_MFA_ENFORCE', 'true')
    signIn('admin', [5, -1])
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.requireStellrAdmin()).toEqual({ ok: false, status: 403 })
    expect(await authz.requireCapability('export')).toEqual({ ok: false, status: 403 })
    expect(await authz.hasPortalAccess()).toBe(false)
    expect(await authz.adminNeedsSecondFactor()).toBe(true)
    await expect(authz.page.requireStellrAdmin()).rejects.toThrow(`REDIRECT ${ADMIN_MFA_PAGE}`)
    await expect(authz.page.requireAdmin()).rejects.toThrow(`REDIRECT ${ADMIN_MFA_PAGE}`)
    const res = await authz.api.requireStellrAdmin()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.deny.status).toBe(403)
  })

  it('flag on, no session field: the account setting decides (MFA off on the account is refused)', async () => {
    vi.stubEnv('ADMIN_MFA_ENFORCE', 'true')
    signIn('admin', null)
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('flag on: a member, Staff with a second factor and an event manager are not affected', async () => {
    vi.stubEnv('ADMIN_MFA_ENFORCE', 'true')
    signIn('member', [5, -1])
    expect(await authz.adminNeedsSecondFactor()).toBe(false)
    signIn('staff', [5, 5])
    expect(await authz.hasCapability('portal:read')).toBe(true)
    expect(await authz.adminNeedsSecondFactor()).toBe(false)
    signIn('event_manager', [5, -1])
    expect(await authz.adminNeedsSecondFactor()).toBe(false)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('flag on, postgres: a tenant_admin membership without a second factor is refused', async () => {
    vi.stubEnv('ADMIN_MFA_ENFORCE', 'true')
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    signIn('member', [5, -1], [{ tenant_id: STELLR_TENANT_ID, role: 'tenant_admin' }])
    expect(await authz.isStellrAdmin()).toBe(false)
    expect(await authz.adminNeedsSecondFactor()).toBe(true)
  })
})
