// @vitest-environment node
//
// The stellr_staff persona (test/idor/harness.ts): Stellr Staff with an active grant and a
// second factor on the session, built as #712's tests build one. The generated suite runs
// it over every crew target, naming a Canary record (test/idor/idor-routes.test.ts). This
// file proves the persona is what it claims, on Stellr's own records, where only a role or
// capability check can refuse:
//   - refused at the guard on admin-only routes, where an admin gets past it;
//   - let through a members:write route, and refused there without a second factor;
//   - refused at the guard in the admin-only areas classed stellr_only, which the crew
//     suite never runs (the access console, clearance decisions, granting Staff, e-sign
//     templates, the store catalogue, scholarship decisions);
//   - the platform routes that let Staff in are the ones the owner gave Staff a capability for;
//   - crewCaseProblem holds Staff to that, and test/idor/staff-accepted.ts cannot widen it.
import './mocks'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { crewTargets, idorTargets, segmentsOf, urlPatternOf, type IdorTarget } from '@/lib/security/idor-targets'
import { HTTP_METHODS, analyzeRoute, requestIdInputs } from '@/lib/security/route-ast'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { GUARD_EXCEPTIONS } from '@/lib/security/route-guards'
import { followBodyHelpers } from './body-helpers'
import { CASE_FIXTURES, applyEnv } from './case-fixtures'
import { CREW_PERSONAS_FOR, SAME_TENANT, crewCaseProblem, installNetworkGuard, runIdorCase, targetInput, type CaseInput, type CaseResult, type CaseOptions, type Persona } from './harness'
import { STAFF_ACCEPTED } from './staff-accepted'
import { staffCapabilitiesIn, staffCapabilitiesInHandler } from './staff-capabilities'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'
process.env.HUBSPOT_PORTAL_ID = 'idor-harness-portal'
delete process.env.NEXT_PUBLIC_SANITY_PROJECT_ID

installNetworkGuard()

vi.setConfig({ testTimeout: 60_000 })

const CREW = crewTargets().map((t) => followBodyHelpers(t))
const PLATFORM = CREW.filter((t) => t.cls !== 'tenant_crew')
const staffCaps = (t: IdorTarget) => staffCapabilitiesIn(t.file, readFileSync(t.file, 'utf8'))

const targetFor = (file: string): IdorTarget => {
  const t = [...CREW, ...idorTargets()].map((x) => followBodyHelpers(x)).find((x) => x.file === file)
  if (!t) throw new Error(`${file} is not a crew or id-bearing route`)
  return t
}

async function run(file: string, method: string, persona: Persona, opts: CaseOptions = {}, input: CaseInput = targetInput(targetFor(file))): Promise<CaseResult> {
  const restore = applyEnv(CASE_FIXTURES[file]?.env)
  const mod = (await import(`../../${file}`).finally(restore)) as Record<string, unknown>
  return runIdorCase(mod, input, method, persona, file, opts)
}

const show = (r: CaseResult) => `${r.method} → ${r.status} ${r.outcome} touched=${r.touched}${r.error ? ` ${r.error}` : ''}`

describe('stellr_staff runs where the other staff personas run', () => {
  it('on every crew route class', () => {
    expect(CREW_PERSONAS_FOR.tenant_crew).toContain('stellr_staff')
    expect(CREW_PERSONAS_FOR.platform_admin).toContain('stellr_staff')
    expect(CREW_PERSONAS_FOR.platform_destined).toContain('stellr_staff')
  })

  // Written out: a platform route that starts checking a Staff capability shows here, and
  // its Staff case then has to reach the id instead of being refused at the guard.
  it('lets Staff into exactly the platform routes that check a capability Staff holds', () => {
    expect(PLATFORM.filter((t) => staffCaps(t).length).map((t) => `${t.file}: ${staffCaps(t).join(', ')}`)).toEqual(['app/api/admin/schools/[id]/route.ts: schools:write'])
  })
})

describe('stellr_staff on Stellr’s own records', () => {
  const DUTIES = 'app/api/admin/duties/route.ts'

  it('an admin gets past the Duties guard to the grant: the control', async () => {
    const r = await run(DUTIES, 'DELETE', 'stellr_crew', { context: SAME_TENANT, strict: true })
    expect(r.touched, show(r)).toBe(true)
  })

  it('Staff is refused at that guard, before the grant is read', async () => {
    const r = await run(DUTIES, 'DELETE', 'stellr_staff', { context: SAME_TENANT, strict: true })
    expect(r.status, show(r)).toBe(403)
    expect(r.outcome, show(r)).toBe('refused')
    expect(r.touched, show(r)).toBe(false)
  })

  // Deletion, view-as, merge, privacy requests, Duties, the slug guard (an events Duty).
  for (const t of PLATFORM.filter((x) => staffCaps(x).length === 0)) {
    it(`Staff is refused at the guard on the admin-only ${t.urlPattern}`, async () => {
      for (const method of t.methods) {
        const r = await run(t.file, method, 'stellr_staff', { context: SAME_TENANT, strict: true })
        // A reviewed guard exception (ending view-as clears the caller's own cookie) has no guard to refuse with.
        if (!(`${t.file}#${method}` in GUARD_EXCEPTIONS)) expect([401, 403, 404], `${t.file} ${show(r)}`).toContain(r.status)
        expect(r.touched, `${t.file} ${show(r)}`).toBe(false)
        expect(r.writes, `${t.file} ${show(r)}`).toEqual([])
      }
    })
  }

  const MEMBERSHIP = 'app/api/admin/members/[id]/memberships/[membershipId]/route.ts'

  it('the membership route checks members:write, a Staff capability', () => {
    expect(staffCaps(targetFor(MEMBERSHIP))).toEqual(['members:write'])
  })

  it('Staff is let through the members:write route to the record', async () => {
    const r = await run(MEMBERSHIP, 'DELETE', 'stellr_staff', { context: SAME_TENANT })
    expect(r.touched, show(r)).toBe(true)
    expect(r.status, show(r)).toBeGreaterThanOrEqual(200)
    expect(r.status, show(r)).toBeLessThan(300)
  })

  it('without a second factor on the session, the same Staff member is refused there', async () => {
    const r = await run(MEMBERSHIP, 'DELETE', 'stellr_staff', { context: SAME_TENANT, staffSecondFactor: false })
    expect(r.status, show(r)).toBe(403)
    expect(r.touched, show(r)).toBe(false)
  })

  it('a participant is refused there too', async () => {
    const r = await run(MEMBERSHIP, 'DELETE', 'participant', { context: SAME_TENANT })
    expect(r.status, show(r)).toBe(403)
    expect(r.touched, show(r)).toBe(false)
  })
})

// The admin-only areas the crew suite cannot reach: every route in them is classed
// stellr_only, and crewTargets() runs only tenant_crew, platform_admin and
// platform_destined. test/staff-route-matrix.test.ts pins them by reading the source
// (ADMIN_ONLY); this runs the request. Its ADMIN_ONLY areas, plus the ones it pins
// elsewhere: clearance (members/[id]/license verifies with clearance:verify), the store
// catalogue and scholarship decisions (their own wrappers, store:write and
// scholarships:write, which Staff does not hold).
const ADMIN_ONLY_AREAS: RegExp[] = [
  /^access(\/|$)/,
  /^members\/\[id\]\/background-check\/adjudicate$/,
  /^members\/\[id\]\/license$/,
  /^members\/\[id\]\/staff$/,
  /^staff-settings$/,
  /^esign\/templates(\/|$)/,
  /^store(\/|$)/,
  /^scholarships(\/|$)/,
]
const adminRoute = (file: string) => file.replace(/^app\/api\/admin\//, '').replace(/\/route\.tsx?$/, '')
const ADMIN_ONLY_FILES = Object.keys(ROUTE_MANIFEST)
  .filter((f) => /^app\/api\/admin\/.*\/route\.tsx?$/.test(f) && ADMIN_ONLY_AREAS.some((re) => re.test(adminRoute(f))))
  .sort()

/** The target of an admin-only route, id-bearing or not (a list names no id, and still has a guard). */
function adminOnlyTarget(file: string): IdorTarget {
  const src = readFileSync(file, 'utf8')
  const methods = analyzeRoute(file, src)
    .handlers.map((h) => h.name)
    .filter((m) => (HTTP_METHODS as readonly string[]).includes(m) && m !== 'HEAD' && m !== 'OPTIONS')
  const { query, body, fill } = requestIdInputs(file, src)
  return followBodyHelpers({ file, cls: ROUTE_MANIFEST[file], urlPattern: urlPatternOf(file), segments: segmentsOf(file), query, body, fill, methods: [...new Set(methods)].sort() })
}
const ADMIN_ONLY_TARGETS = ADMIN_ONLY_FILES.map(adminOnlyTarget)
const handlerCaps = (t: IdorTarget, method: string) => staffCapabilitiesInHandler(t.file, readFileSync(t.file, 'utf8'), method)
const idBearing = (t: IdorTarget) => t.segments.length + t.query.length + t.body.length > 0

/** Verifying or unverifying a licence decides clearance; saving its details is members:write, which Staff holds. */
const LICENSE = 'app/api/admin/members/[id]/license/route.ts'
const licenseVerify = (): CaseInput => ({
  ...targetInput(targetFor(LICENSE)),
  fixture: { reason: 'verify decides clearance: the save branch is members:write', body: { action: 'verify', licenseUpdatedAt: '2026-01-01T00:00:00.000Z' } },
})

describe('stellr_staff in the admin-only areas the crew suite never runs', () => {
  it('finds the areas, every route in them classed stellr_only, none a crew target', () => {
    for (const re of ADMIN_ONLY_AREAS) expect(ADMIN_ONLY_FILES.some((f) => re.test(adminRoute(f))), String(re)).toBe(true)
    expect(ADMIN_ONLY_FILES.filter((f) => ROUTE_MANIFEST[f] !== 'stellr_only')).toEqual([])
    const crew = new Set(CREW.map((t) => t.file))
    expect(ADMIN_ONLY_FILES.filter((f) => crew.has(f))).toEqual([])
  })

  // Written out: a handler here that starts checking a capability Staff holds shows, and
  // has to be argued for. Each is a read (portal:read), or the licence save, whose verify
  // branch is still refused below.
  it('Staff holds a capability on only these handlers, none a decision', () => {
    const staffIn = ADMIN_ONLY_TARGETS.flatMap((t) => t.methods.filter((m) => handlerCaps(t, m).length).map((m) => `${adminRoute(t.file)} ${m}: ${handlerCaps(t, m).join(', ')}`))
    expect(staffIn).toEqual([
      'esign/templates/[id]/preview GET: portal:read',
      'members/[id]/license POST: members:write',
      'scholarships/[id]/refund-quote GET: portal:read',
      'store/discounts GET: portal:read',
      'store/printful GET: portal:read',
      'store/products/[id] GET: portal:read',
      'store/products GET: portal:read',
    ])
  })

  it('reads a handler\'s capabilities through the same-file functions it calls, and no further', () => {
    const src = [
      "import { withAudit as audited } from '@/lib/audit/route'",
      "import { withCronAudit } from '@/lib/cron-audit'",
      "import { withSomething } from '@/lib/elsewhere'",
      "async function guard() { return hasCapability('members:write') }",
      "async function adminOnly() { return isStellrAdmin() }",
      "async function save(req: Request) { if (!(await hasCapability('members:write'))) return deny() }",
      "async function read() { await guard() }",
      'export async function GET() { await guard() }',
      'export const POST = audited(audit, async () => { await adminOnly() })',
      "export async function DELETE() { await canManageStoreCatalog() }",
      "export async function PATCH() { await canManageStoreCatalog('portal:read') }",
      // A wrapped handler, given by name, is read as the function it names, followed through.
      'export const PUT = audited((o) => ({ action: o.args.length }), save)',
      'export const HEAD = withCronAudit(\'job\', read)',
      // Not an audit wrapper: nothing says it calls what it is given, so it reads as checking nothing.
      'export const OPTIONS = withSomething(audit, save)',
    ].join('\n')
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'GET')).toEqual(['members:write'])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'POST')).toEqual([])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'DELETE')).toEqual([])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'PATCH')).toEqual(['portal:read'])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'PUT')).toEqual(['members:write'])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'HEAD')).toEqual(['members:write'])
    expect(staffCapabilitiesInHandler('x/route.ts', src, 'OPTIONS')).toEqual([])
    expect(() => staffCapabilitiesInHandler('x/route.ts', src, 'TRACE')).toThrow(/no TRACE/)
  })

  for (const t of ADMIN_ONLY_TARGETS) {
    const methods = t.methods.filter((m) => handlerCaps(t, m).length === 0)
    if (methods.length === 0) continue
    it(`Staff is refused at the guard on ${t.urlPattern} (${methods.join(', ')})`, async () => {
      for (const method of methods) {
        const r = await run(t.file, method, 'stellr_staff', { context: SAME_TENANT, strict: true }, targetInput(t))
        if (!(`${t.file}#${method}` in GUARD_EXCEPTIONS)) expect([401, 403], `${t.file} ${show(r)}`).toContain(r.status)
        expect(r.touched, `${t.file} ${show(r)}`).toBe(false)
        expect(r.writes, `${t.file} ${show(r)}`).toEqual([])
        expect(r.leaks, `${t.file} ${show(r)}`).toEqual([])
      }
    })
  }

  it('the id-bearing ones are most of them: a refusal there is a refusal before the id', () => {
    expect(ADMIN_ONLY_TARGETS.filter(idBearing).length).toBeGreaterThanOrEqual(25)
  })

  it('Staff is refused verifying a teaching licence, before the licence is read', async () => {
    const r = await run(LICENSE, 'POST', 'stellr_staff', { context: SAME_TENANT, strict: true }, licenseVerify())
    expect(r.status, show(r)).toBe(403)
    expect(r.touched, show(r)).toBe(false)
    expect(r.writes, show(r)).toEqual([])
  })

  // The controls: the same requests from an admin get past the guard to the record, so
  // the refusals above are the guard's, not a request that could never get anywhere.
  it('an admin gets past the licence guard to the licence: the control', async () => {
    const r = await run(LICENSE, 'POST', 'stellr_crew', { context: SAME_TENANT, strict: true }, licenseVerify())
    expect(r.touched, show(r)).toBe(true)
  })

  for (const [file, method] of [
    ['app/api/admin/members/[id]/staff/route.ts', 'GET'],
    ['app/api/admin/access/people/[id]/route.ts', 'GET'],
    ['app/api/admin/scholarships/[id]/route.ts', 'PATCH'],
    ['app/api/admin/store/products/[id]/route.ts', 'DELETE'],
  ] as const) {
    it(`an admin gets past the guard on ${adminRoute(file)} ${method}: the control`, async () => {
      const r = await run(file, method, 'stellr_crew', { context: SAME_TENANT, strict: true }, targetInput(adminOnlyTarget(file)))
      expect(r.touched, show(r)).toBe(true)
    })
  }
})

describe('crewCaseProblem holds Staff to its capabilities', () => {
  const result = (over: Partial<CaseResult>): CaseResult => ({ method: 'GET', status: 403, outcome: 'refused', leaks: [], writes: [], touched: false, audits: [], ...over })
  const onPlatform = (over: Partial<CaseResult>, staffCapabilities: string[] = [], extra: Partial<Parameters<typeof crewCaseProblem>[0]> = {}) =>
    crewCaseProblem({ cls: 'platform_destined', persona: 'stellr_staff', result: result(over), idBearing: true, staffCapabilities, ...extra })

  it('on an admin-only route: refused at the guard passes; past it, or answered, fails', () => {
    expect(onPlatform({})).toBeNull()
    expect(onPlatform({ status: 404, touched: true })).toContain('let Staff past its guard')
    expect(onPlatform({ status: 200, outcome: 'ok', touched: true })).toContain('200')
    expect(onPlatform({ status: 400, outcome: 'unexercised' })).toContain('400')
    expect(onPlatform({ status: 403, touched: true }, [], { guardExempt: true })).toContain('guard-exempt')
  })

  it('on a route that lets Staff in: it must reach the id, and a failing outcome still fails', () => {
    expect(onPlatform({ status: 404, touched: true }, ['schools:write'])).toBeNull()
    expect(onPlatform({ status: 403, touched: false }, ['schools:write'])).toContain('nothing touched')
    expect(onPlatform({ status: 400, outcome: 'unexercised' }, ['schools:write'])).toContain('unexercised')
    expect(onPlatform({ status: 200, outcome: 'leak', touched: true }, ['schools:write'])).toContain('leak')
  })

  it('an acceptance covers only its own outcome, with a reviewed reason, on a route that lets Staff in', () => {
    const accepted = { outcome: 'leak' as const, reason: 'a reviewed reason that is long enough to read' }
    const leak = { status: 200, outcome: 'leak' as const, touched: true }
    expect(onPlatform(leak, ['schools:write'], { staffAccepted: accepted })).toBeNull()
    expect(onPlatform({ ...leak, outcome: 'honey_write' }, ['schools:write'], { staffAccepted: accepted })).toContain('now honey_write')
    expect(onPlatform(leak, ['schools:write'], { staffAccepted: { ...accepted, reason: 'TODO: review' } })).toContain('no reviewed reason')
    expect(onPlatform(leak, [], { staffAccepted: accepted })).toContain('cannot cover')
    expect(crewCaseProblem({ cls: 'tenant_crew', persona: 'stellr_staff', result: result(leak), idBearing: true, staffCapabilities: ['members:write'], staffAccepted: accepted })).toContain('cannot cover')
    expect(crewCaseProblem({ cls: 'platform_destined', persona: 'canary_admin', result: result(leak), idBearing: true, staffCapabilities: ['schools:write'], staffAccepted: accepted })).toContain('cannot cover')
  })

  it('on a tenant_crew route Staff holds the whole Stellr tenant, so it must reach the id', () => {
    expect(crewCaseProblem({ cls: 'tenant_crew', persona: 'stellr_staff', result: result({}), idBearing: true })).toContain('never reached')
    expect(crewCaseProblem({ cls: 'tenant_crew', persona: 'stellr_staff', result: result({ status: 404, touched: true }), idBearing: true })).toBeNull()
  })
})

describe('test/idor/staff-accepted.ts', () => {
  it('names only platform routes that let Staff in, each with a reviewed reason', () => {
    for (const [key, a] of Object.entries(STAFF_ACCEPTED)) {
      const [file, method] = key.split(' ')
      const t = PLATFORM.find((x) => x.file === file)
      expect(t, `${key}: not a platform route`).toBeDefined()
      expect(t?.methods, key).toContain(method)
      expect(staffCaps(t as IdorTarget).length, `${key}: the route checks no capability Staff holds`).toBeGreaterThan(0)
      expect(a.reason, key).not.toMatch(/TODO/)
      expect(a.reason.length, key).toBeGreaterThan(20)
    }
  })
})
