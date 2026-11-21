/**
 * The truth table of lib/authz.ts (multi-tenancy plan S5; slice C1, pinned as a table at C25).
 *
 * For every Stellr role scenario (Clerk claim × assignments × member row × admin_duties
 * scopes × the owner's platform flag), every decision that replaced a legacy guard idiom is
 * run through lib/authz and compared with the answer this file writes down for it
 * (`expected`, below):
 *
 *   clerk source     must give the expected answer in EVERY scenario. This is the default.
 *   postgres source  reads tenant_memberships / platform_admins written by the S3 mapping
 *                    (lib/tenancy/role-mapping.ts) from the same data. It must give the same
 *                    answers whenever today's data is synced. Where it is not (a Clerk
 *                    event_manager with no assignment, or an assignment without the Clerk
 *                    role) the portal / event-manager answers follow the tables; the harness
 *                    pins exactly which answers move, and that every admin-only and scope
 *                    answer still agrees.
 *
 * Until C25 the expected side was the legacy helpers themselves (lib/admin-auth.ts, frozen in
 * test/fixtures/authz-legacy.ts, and lib/event-access.ts). C25 batch 4 (21 Nov 2026) deleted
 * them, so the table is written out here instead, with the legacy rule for every claim the
 * legacy helpers knew, and one deliberate change: Staff (the owner's decision of 21 Nov 2026,
 * docs/RUNBOOK-staff-role.md) reach every Stellr event, not as an admin. Staff were already
 * in the portal and in the crew-target list. The Staff scenarios are added here; the shared
 * fixture (test/fixtures/authz-principal.ts) keeps its legacy claim list, because the
 * codemod's equivalence proof still compares against the frozen legacy code, which has no
 * Staff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allScenarios,
  ASSIGNMENT_SETS,
  fakeDb,
  isSynced,
  MEMBER,
  SCOPE_SETS,
  scenarioAuth,
  scenarioTables,
  USER,
  type FakeDb,
  type Scenario,
} from '@/test/fixtures/authz-principal'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn(), currentUser: vi.fn(async () => null) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: vi.fn(async () => null) }))
vi.mock('@/lib/esign/native/template-admin', () => ({ TemplateAdminError: class extends Error {} }))

import { auth, clerkClient } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { adminName } from '@/app/api/admin/esign/templates/guard'
import * as authz from '@/lib/authz'

const SLUGS = [undefined, 'ev-a', 'ev-b', 'ev-z'] as const
const SCOPES = ['events', 'community'] as const
const PORTAL_ROLES = ['admin', 'staff', 'event_manager']

/** The Staff scenarios: the shared fixture's combinations, with the 'staff' claim. */
function staffScenarios(): Scenario[] {
  const out: Scenario[] = []
  for (const assignments of ASSIGNMENT_SETS)
    for (const hasMember of [true, false])
      for (const dutyScopes of hasMember ? SCOPE_SETS : [null])
        for (const platformFlag of [false, true])
          out.push({
            name: `role=staff assigned=${assignments.join('+') || '-'} member=${hasMember} scopes=${dutyScopes === null ? '-' : dutyScopes.join('+') || 'none'} platform=${platformFlag}`,
            signedIn: true,
            claimsRole: 'staff',
            assignments,
            dutyScopes,
            hasMember,
            platformFlag,
          })
  return out
}

let db: FakeDb

/** The tables for a scenario; Staff also holds its Stellr 'staff' membership, as lib/staff.ts writes it. */
function tablesFor(s: Scenario) {
  const tables = scenarioTables(s)
  if (s.signedIn && s.claimsRole === 'staff') {
    tables.tenant_memberships = [...(tables.tenant_memberships ?? []), { tenant_id: STELLR_TENANT_ID, role: 'staff', clerk_user_id: USER, member_id: null }]
  }
  return tables
}

function use(s: Scenario) {
  db = fakeDb(tablesFor(s))
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  // Staff counts only on a session with a second factor (staff-role.8); every Staff scenario has one.
  vi.mocked(auth).mockResolvedValue({ ...scenarioAuth(s), factorVerificationAge: s.signedIn ? [0, 0] : null } as never)
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (e) {
    return e instanceof Error ? e.message : 'threw'
  }
}

/** The expected answer to each decision, written out from the rules. */
function expected(s: Scenario): Record<string, unknown> {
  const role = s.signedIn ? s.claimsRole : undefined
  const admin = role === 'admin'
  const staff = role === 'staff'
  const portal = role !== undefined && PORTAL_ROLES.includes(role)
  const page = (allowed: boolean) => (!s.signedIn ? 'REDIRECT /sign-in' : allowed ? 'ok' : 'NOT_FOUND')
  const out: Record<string, unknown> = {
    isStellrAdmin: admin,
    requireStellrAdmin: admin ? 'ok' : s.signedIn ? 403 : 401,
    hasPortalAccess: portal,
    'page.requireAdmin': page(portal),
    // Admin-only pages refuse Staff: only an admin passes.
    'page.requireStellrAdmin': page(admin),
    'page.requireCapability(portal:read)': page(admin || staff),
    isCrewTarget: portal,
    'hasCapability(competitions:write)': admin || staff,
    'hasCapability(access:manage)': admin,
    requireScholarshipAdmin: admin,
    requireSurveyAdmin: !s.signedIn ? 401 : admin || staff ? 'ok' : 403,
    canManageStoreCatalog: admin,
    adminName: admin,
  }
  for (const slug of SLUGS) {
    let answer: unknown
    if (!s.signedIn) answer = { ok: false, status: 401 }
    else if (admin) answer = { ok: true, userId: USER, isAdmin: true, assignedSlugs: null, tenantId: STELLR_TENANT_ID }
    // Owner decision, 21 Nov 2026: Staff reach every Stellr event, not as an admin.
    else if (staff) answer = { ok: true, userId: USER, isAdmin: false, assignedSlugs: null, tenantId: STELLR_TENANT_ID }
    else if (role === 'event_manager')
      answer =
        slug && !s.assignments.includes(slug)
          ? { ok: false, status: 403 }
          : { ok: true, userId: USER, isAdmin: false, assignedSlugs: s.assignments, tenantId: STELLR_TENANT_ID }
    else answer = { ok: false, status: 403 }
    out[`requireEventAccess(${slug ?? ''})`] = answer
  }
  for (const scope of SCOPES) {
    const held = s.hasMember && s.dutyScopes !== null && (s.dutyScopes.includes('all') || s.dutyScopes.includes(scope))
    out[`hasScope(${scope})`] = s.signedIn && (admin || held)
  }
  return out
}

/** lib/authz's answer to each decision, under the configured source. */
async function actual(s: Scenario): Promise<Record<string, unknown>> {
  const adminDecision = await authz.requireStellrAdmin()
  const out: Record<string, unknown> = {
    isStellrAdmin: await authz.isStellrAdmin(),
    requireStellrAdmin: adminDecision.ok ? 'ok' : adminDecision.status,
    hasPortalAccess: await authz.hasPortalAccess(),
    'page.requireAdmin': await outcome(() => authz.page.requireAdmin()),
    'page.requireStellrAdmin': await outcome(() => authz.page.requireStellrAdmin()),
    'page.requireCapability(portal:read)': await outcome(() => authz.page.requireCapability('portal:read')),
    isCrewTarget: await authz.isCrewTarget({ clerkUserId: s.signedIn ? USER : null, clerkRole: s.signedIn ? s.claimsRole : undefined }),
    'hasCapability(competitions:write)': await authz.hasCapability('competitions:write'),
    'hasCapability(access:manage)': await authz.hasCapability('access:manage'),
    requireScholarshipAdmin: (await requireScholarshipAdmin()) !== null,
    requireSurveyAdmin: await requireSurveyAdmin().then((r) => (r.ok ? 'ok' : r.response.status)),
    canManageStoreCatalog: await canManageStoreCatalog(),
    adminName: (await adminName()) !== null,
  }
  for (const slug of SLUGS) out[`requireEventAccess(${slug ?? ''})`] = await authz.requireEventAccess(slug)
  for (const scope of SCOPES) out[`hasScope(${scope})`] = await authz.hasScope(scope)
  return out
}

/** The decisions whose postgres answer may follow the tables when data is not synced. */
const DRIFT_SENSITIVE = /^(hasPortalAccess|page\.requireAdmin|isCrewTarget|requireEventAccess)/

const legacyScenarios = allScenarios()
const staff = staffScenarios()
const scenarios = [...legacyScenarios, ...staff]

beforeEach(() => {
  vi.stubEnv('AUTHZ_SOURCE', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the lib/authz truth table', () => {
  it('covers the whole truth table, Staff included', () => {
    expect(legacyScenarios.length).toBe(151)
    expect(staff.length).toBe(30)
    expect(scenarios.filter(isSynced).length).toBeGreaterThan(60)
    expect(scenarios.filter((s) => !isSynced(s)).length).toBeGreaterThan(30)
  })

  it.each(scenarios.map((s) => [s.name, s] as const))('clerk source gives the expected answers: %s', async (_name, s) => {
    use(s)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await actual(s)).toEqual(expected(s))
  })

  it.each(scenarios.filter(isSynced).map((s) => [s.name, s] as const))('postgres source gives them on synced data: %s', async (_name, s) => {
    use(s)
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    expect(await actual(s)).toEqual(expected(s))
  })

  it('on unsynced data only the event-manager answers move, and admin, Staff and scope answers never do', async () => {
    const moved = new Set<string>()
    for (const s of scenarios.filter((x) => !isSynced(x))) {
      use(s)
      const want = expected(s)
      vi.stubEnv('AUTHZ_SOURCE', 'postgres')
      const got = await actual(s)
      vi.stubEnv('AUTHZ_SOURCE', '')
      for (const key of Object.keys(want)) {
        if (JSON.stringify(want[key]) === JSON.stringify(got[key])) continue
        expect(key, s.name).toMatch(DRIFT_SENSITIVE)
        // Staff holding an assignment as well answers as Staff in both sources.
        expect(s.claimsRole, `${s.name} ${key}`).not.toBe('staff')
        // The crew-target check protects, so drift may only add protection.
        if (key === 'isCrewTarget') expect([want[key], got[key]], s.name).toEqual([false, true])
        moved.add(key)
      }
    }
    // The drift is real (so a role-sync check is needed before any flip) …
    expect([...moved].sort()).toEqual([
      'hasPortalAccess',
      'isCrewTarget',
      'page.requireAdmin',
      'requireEventAccess()',
      'requireEventAccess(ev-a)',
      'requireEventAccess(ev-b)',
    ])
  })

  it('a Clerk event_manager with no assignment loses the portal under postgres; a stray assignment gains it', async () => {
    const em = scenarios.find((s) => s.claimsRole === 'event_manager' && s.assignments.length === 0 && s.hasMember)!
    use(em)
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    expect(await authz.hasPortalAccess()).toBe(false)

    const stray = scenarios.find((s) => s.claimsRole === 'student' && s.assignments.length === 1 && s.hasMember)!
    use(stray)
    expect(await authz.hasPortalAccess()).toBe(true)
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: ['ev-a'], tenantId: STELLR_TENANT_ID })
    expect(await authz.isStellrAdmin()).toBe(false)
  })

  it('the clerk source adds no database read to claim-only decisions', async () => {
    for (const s of scenarios) {
      use(s)
      vi.stubEnv('AUTHZ_SOURCE', 'clerk')
      await authz.isStellrAdmin()
      await authz.requireStellrAdmin()
      await authz.hasPortalAccess()
      await authz.hasCapability('competitions:write')
      await outcome(() => authz.page.requireAdmin())
      await authz.isCrewTarget({ clerkUserId: USER, clerkRole: s.claimsRole })
      expect(db.reads, s.name).toEqual([])
    }
  })

  it('the clerk source reads assignments for an event manager only, as the legacy gate did (Staff and admins need none)', async () => {
    for (const s of scenarios) {
      use(s)
      vi.stubEnv('AUTHZ_SOURCE', 'clerk')
      await authz.requireEventAccess('ev-a')
      expect(db.reads, s.name).toEqual(s.signedIn && s.claimsRole === 'event_manager' ? ['event_manager_assignments'] : [])
      vi.stubEnv('AUTHZ_SOURCE', '')
    }
  })
})

describe('Staff, the owner decision of 21 Nov 2026', () => {
  const plain = staff.find((s) => s.assignments.length === 0 && !s.hasMember && !s.platformFlag)!

  it.each(['clerk', 'postgres'])('under %s Staff reaches a Stellr event and every event in the list, not as an admin', async (source) => {
    use(plain)
    vi.stubEnv('AUTHZ_SOURCE', source)
    for (const slug of ['ev-a', 'ev-z', undefined]) {
      expect(await authz.requireEventAccess(slug), String(slug)).toEqual({ ok: true, userId: USER, isAdmin: false, assignedSlugs: null, tenantId: STELLR_TENANT_ID })
    }
  })

  it.each(['clerk', 'postgres'])('under %s Staff is refused the admin-only pages and decisions', async (source) => {
    use(plain)
    vi.stubEnv('AUTHZ_SOURCE', source)
    expect(await outcome(() => authz.page.requireStellrAdmin())).toBe('NOT_FOUND')
    expect(await authz.isStellrAdmin()).toBe(false)
    for (const cap of ['access:manage', 'roles:manage', 'duties:manage', 'impersonate', 'privacy:read', 'scholarships:write', 'store:write'] as const) {
      expect(await authz.hasCapability(cap), cap).toBe(false)
    }
  })

  it('Staff on a session with no second factor is treated as not Staff: no event, no portal', async () => {
    use(plain)
    vi.mocked(auth).mockResolvedValue({ ...scenarioAuth(plain), factorVerificationAge: [0, -1] } as never)
    vi.mocked(clerkClient).mockResolvedValue({ users: { getUser: async () => ({ twoFactorEnabled: false }) } } as never)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
    expect(await authz.hasPortalAccess()).toBe(false)
  })

  it('an event manager keeps exactly their assigned events, and a plain member gains nothing', async () => {
    const em = legacyScenarios.find((s) => s.claimsRole === 'event_manager' && s.assignments.join() === 'ev-a' && !s.hasMember && !s.platformFlag)!
    use(em)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await authz.requireEventAccess('ev-a')).toMatchObject({ ok: true, isAdmin: false, assignedSlugs: ['ev-a'] })
    expect(await authz.requireEventAccess('ev-b')).toEqual({ ok: false, status: 403 })
    expect(await authz.requireEventAccess()).toMatchObject({ ok: true, assignedSlugs: ['ev-a'] })

    const member = legacyScenarios.find((s) => s.claimsRole === 'member' && s.assignments.length === 0 && !s.hasMember && !s.platformFlag)!
    use(member)
    expect(await authz.requireEventAccess('ev-a')).toEqual({ ok: false, status: 403 })
    expect(await authz.requireEventAccess()).toEqual({ ok: false, status: 403 })
    expect(await authz.hasPortalAccess()).toBe(false)
  })
})

describe('the claim and crew-target rules take any value the same way', () => {
  it('portalRoleFromClaims (replaced isAdminClaims, isEventManagerClaims, hasAdminPortalAccess)', () => {
    const table: [unknown, string | null][] = [
      [null, null],
      [undefined, null],
      [{}, null],
      [{ metadata: null }, null],
      [{ metadata: {} }, null],
      [{ metadata: { role: 'admin' } }, 'admin'],
      [{ metadata: { role: 'staff' } }, 'staff'],
      [{ metadata: { role: 'event_manager' } }, 'event_manager'],
      [{ metadata: { role: 'Admin' } }, null],
      [{ metadata: { role: 7 } }, null],
      [{ metadata: { role: ['admin'] } }, null],
      [{ metadata: { role: 'member' } }, null],
    ]
    for (const [claims, want] of table) expect(authz.portalRoleFromClaims(claims as never), JSON.stringify(claims)).toBe(want)
  })

  it('isCrewTarget on the Clerk role (replaced isCrewRole and CREW_CLERK_ROLES): admin, Staff and event managers only', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    db = fakeDb({})
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    const table: [unknown, boolean][] = [
      [undefined, false],
      [null, false],
      ['', false],
      ['admin', true],
      ['staff', true],
      ['event_manager', true],
      ['member', false],
      ['Admin', false],
      [7, false],
      [['admin'], false],
      [{}, false],
    ]
    for (const [role, want] of table) expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: role }), String(role)).toBe(want)
  })
})

describe('the view-as refusal, against the rule the start route held before C14', () => {
  type Clerk = 'no_login' | 'not_found' | 'down' | { role: unknown }
  const CLERK_STATES: Clerk[] = [
    'no_login',
    'not_found',
    'down',
    { role: undefined },
    { role: 'admin' },
    { role: 'staff' },
    { role: 'event_manager' },
    { role: 'student' },
    { role: 'member' },
    { role: 7 },
  ]

  /** What app/api/admin/impersonation/route.ts answered: 403, 503, or carry on. Staff joined the crew roles on 13 Nov 2026. */
  function expectedRefusal(row: 'none' | 'held' | 'read_fails', clerk: Clerk): 403 | 503 | null {
    if (row === 'read_fails') return 503
    if (row === 'held') return 403
    if (clerk === 'no_login' || clerk === 'not_found') return null
    if (clerk === 'down') return 503
    return typeof clerk.role === 'string' && PORTAL_ROLES.includes(clerk.role) ? 403 : null
  }

  function target(row: 'none' | 'held' | 'read_fails', clerk: Clerk) {
    const getUser = vi.fn(async () => {
      if (clerk === 'not_found') throw Object.assign(new Error('no such user'), { status: 404 })
      if (clerk === 'down') throw Object.assign(new Error('unavailable'), { status: 503 })
      return { publicMetadata: { role: (clerk as { role: unknown }).role } }
    })
    vi.mocked(clerkClient).mockResolvedValue({ users: { getUser } } as never)
    db = fakeDb({ admin_duties: row === 'held' ? [{ member_id: MEMBER, scopes: [] }] : [] })
    if (row === 'read_fails') db.fail.add('admin_duties')
    vi.mocked(supabaseServer).mockReturnValue(db.client)
    return { getUser, args: { memberId: MEMBER, clerkUserId: clerk === 'no_login' ? null : USER } }
  }

  async function refusal(args: { memberId: string; clerkUserId: string | null }): Promise<403 | 503 | null> {
    try {
      return (await authz.isViewAsTargetCrew(args)) ? 403 : null
    } catch {
      return 503
    }
  }

  const cases = (['none', 'held', 'read_fails'] as const).flatMap((row) => CLERK_STATES.map((clerk) => [row, clerk] as const))

  it.each(cases)('row %s, Clerk %j', async (row, clerk) => {
    const { args, getUser } = target(row, clerk)
    vi.stubEnv('AUTHZ_SOURCE', 'clerk')
    expect(await refusal(args)).toBe(expectedRefusal(row, clerk))
    // The row is read first, so a holder or a failed read never reaches Clerk, as before.
    if (row !== 'none' || clerk === 'no_login') expect(getUser).not.toHaveBeenCalled()
    // And no read beyond the row: the rest is the Clerk record.
    expect(db.reads).toEqual(['admin_duties'])
  })

  it('an admin_duties row with empty scopes refuses, though isCrewTarget alone would not count it', async () => {
    const { args } = target('held', { role: 'student' })
    expect(await authz.isCrewTarget({ clerkUserId: USER, clerkRole: 'student', memberId: MEMBER })).toBe(false)
    expect(await refusal(args)).toBe(403)
  })

  it('under postgres a table role also refuses, and a failed table read is "could not confirm", not "is staff"', async () => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'tenant', role: 'tenant_admin', member_id: MEMBER }]
    expect(await refusal(args)).toBe(403)
    db.tables.tenant_memberships = []
    expect(await refusal(args)).toBe(null)
    db.fail.add('tenant_memberships')
    expect(await refusal(args)).toBe(503)
  })

  it('under postgres a staff membership in any tenant refuses: another tenant has no admin_duties row', async () => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'another-tenant', role: 'duty_holder', member_id: MEMBER }]
    expect(await refusal(args)).toBe(403)
  })

  it.each(['clerk', 'shadow'])('under %s a staff membership changes nothing, and is not read for this rule', async (source) => {
    const { args } = target('none', { role: 'student' })
    vi.stubEnv('AUTHZ_SOURCE', source)
    db.tables.members = [{ id: MEMBER, clerk_user_id: USER }]
    db.tables.tenant_memberships = [{ tenant_id: 'another-tenant', role: 'duty_holder', member_id: MEMBER }]
    expect(await refusal(args)).toBe(null)
  })
})
