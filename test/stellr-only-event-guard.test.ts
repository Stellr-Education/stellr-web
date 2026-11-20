// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeRoute } from '@/lib/security/route-ast'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_ONLY_DISPOSITIONS } from '@/lib/security/stellr-only-dispositions'

// REQ-EVT (S5 wave 8, slice 9; tracker s5-programme.28). A route under events/[slug] that
// acts on Stellr's own accounts and records must refuse another tenant's event, for a Stellr
// admin too, before it reads anything about a person. It does that with the Stellr-only
// option, stellrOnlyEvent (lib/tenancy/load-scoped.ts), called right after the access check:
// a tenant's staff get a 503, another tenant's event a 404, a failed owner read a retryable 503.
//
// This walks every such route statically (lib/security/route-ast.ts gives each handler's
// calls, in the order the handler reaches them, through same-file helpers) and fails when a
// handler reaches anything but the access check and audit bookkeeping before the option, or
// never reaches the option at all. The routes walked are:
//   - STELLR_ACCOUNT_ROUTES: tenant_crew routes that run on Stellr's signing accounts, sender,
//     Stripe account or store, or issue in Stellr's name (credentials, and the badge and
//     certificate artwork: decision W7-9). They left the Stellr-only register (C16 to C19a)
//     and carry the option instead.
//   - every events/[slug] route still in the Stellr-only register
//     (lib/security/stellr-only-dispositions.ts). Those not yet on the option are listed in
//     PENDING_C19A, which only shrinks: C19a converted seven, C19b the two awards routes and C19c the admin check-in;
//     it is now empty.

const OPTION = 'stellrOnlyEvent'
const OPTION_ORIGIN = 'lib/tenancy/load-scoped'

/** Calls a handler may reach before the option: the access check and audit bookkeeping. */
const BEFORE_OPTION = new Set([
  'withAudit',
  'auditSubject',
  'noteAuditSubject',
  'requireEventRoute',
  'requireEventCrew',
  'requireEventAccess',
  'supabaseServer',
  'json',
])

const EVENTS_DIR = 'app/api/admin/events/[slug]'

const STELLR_ACCOUNT_ROUTES = [
  `${EVENTS_DIR}/remind/route.ts`,
  `${EVENTS_DIR}/docusign-reissue/route.ts`,
  `${EVENTS_DIR}/participants/[pid]/guardian/route.ts`,
  `${EVENTS_DIR}/offerings/route.ts`,
  `${EVENTS_DIR}/merch/commit/route.ts`,
  `${EVENTS_DIR}/invoice-paid/route.ts`,
  `${EVENTS_DIR}/payment-link/route.ts`,
  // C19a: Stellr's credentials and artwork (W7-9).
  `${EVENTS_DIR}/credentials/route.ts`,
  `${EVENTS_DIR}/badge-templates/route.ts`,
  `${EVENTS_DIR}/badge-templates/preview/route.ts`,
  `${EVENTS_DIR}/badges/route.ts`,
  `${EVENTS_DIR}/certificate-templates/route.ts`,
  `${EVENTS_DIR}/certificate-templates/preview/route.ts`,
  `${EVENTS_DIR}/certificates/route.ts`,
  // C19b: awards become Stellr-issued credentials (W7-9).
  `${EVENTS_DIR}/awards/route.ts`,
  `${EVENTS_DIR}/awards/issue/route.ts`,
  // C19c: the admin check-in desk, Stellr-only until a tenant's own desk in S8 (WD-C19-DESK).
  `${EVENTS_DIR}/check-in/route.ts`,
]

/**
 * Register routes under events/[slug] that read people on legacy requireEventAccess(slug)
 * without the option. C19a converted credentials and the artwork routes, C19b the awards;
 * C19's last part converts the admin check-in.
 * Shrink-only: an entry that gains the option, or leaves the register, fails until removed.
 */
// Empty since C19c (S5 wave 8). Kept, typed, so a new entry still has to be argued in.
const PENDING_C19A = new Set<string>([])

/** What is wrong with each handler of a Stellr-only event route; empty when it is guarded. */
function stellrOnlyViolations(fileName: string, src: string): string[] {
  const out: string[] = []
  const { handlers } = analyzeRoute(fileName, src)
  if (handlers.length === 0) out.push(`${fileName}: no handler found`)
  for (const h of handlers) {
    const calls = [...h.calls]
    const at = calls.indexOf(OPTION)
    if (at < 0) {
      const reads = calls.filter((c) => !BEFORE_OPTION.has(c))
      out.push(`${h.name}: reads (${reads.join(', ') || 'nothing'}) without the Stellr-only option`)
      continue
    }
    if (!h.origins.get(OPTION)?.has(OPTION_ORIGIN)) out.push(`${h.name}: ${OPTION} is not the one from ${OPTION_ORIGIN}`)
    const early = calls.slice(0, at).filter((c) => !BEFORE_OPTION.has(c))
    if (early.length) out.push(`${h.name}: reaches ${early.join(', ')} before the Stellr-only option`)
  }
  return out
}

function routesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = path.posix.join(dir, name)
    if (statSync(p).isDirectory()) out.push(...routesUnder(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

const REGISTER_EVENT_ROUTES = Object.keys(STELLR_ONLY_DISPOSITIONS).filter((f) => f.startsWith(`${EVENTS_DIR}/`))
const WALKED = [...STELLR_ACCOUNT_ROUTES, ...REGISTER_EVENT_ROUTES]
const read = (f: string) => readFileSync(f, 'utf8')

describe('Stellr-only event routes ask the Stellr-only option before reading a person (REQ-EVT)', () => {
  it('walks real routes: each listed file exists and sits under events/[slug]', () => {
    const present = new Set(routesUnder(EVENTS_DIR))
    for (const f of WALKED) expect(present.has(f), f).toBe(true)
    // Since C19c (S5 wave 8) no events/[slug] route is left in the Stellr-only register: each one
    // is tenant_crew with the option (STELLR_ACCOUNT_ROUTES) or tenant-capable. The walk is not empty.
    expect(REGISTER_EVENT_ROUTES).toEqual([])
    expect(WALKED.length).toBeGreaterThan(0)
  })

  it.each(STELLR_ACCOUNT_ROUTES)('%s is tenant_crew and off the register', (f) => {
    expect(ROUTE_MANIFEST[f], f).toBe('tenant_crew')
    expect(STELLR_ONLY_DISPOSITIONS[f], f).toBeUndefined()
  })

  it.each(WALKED.filter((f) => !PENDING_C19A.has(f)))('%s asks the option before any other read', (f) => {
    expect(stellrOnlyViolations(f, read(f))).toEqual([])
  })

  it('PENDING_C19A only shrinks: each entry is still in the register and still lacks the option', () => {
    for (const f of PENDING_C19A) {
      expect(REGISTER_EVENT_ROUTES, f).toContain(f)
      expect(existsSync(f), f).toBe(true)
      expect(stellrOnlyViolations(f, read(f)).length, `${f} is guarded now: remove it from PENDING_C19A`).toBeGreaterThan(0)
    }
  })
})

describe('the guard fails on an unguarded route (fixtures)', () => {
  const FIXTURE = `${EVENTS_DIR}/fixture/route.ts`
  const header = `
import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { getEventRoster } from '@/lib/event-admin'
`

  it('a route that reads the roster without the option fails', () => {
    const src = `${header}
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: 'fixture' })
  if (!crew.ok) return crew.response
  return NextResponse.json(await getEventRoster(slug, null, {}))
}`
    expect(stellrOnlyViolations(FIXTURE, src)).toEqual(['GET: reads (getEventRoster) without the Stellr-only option'])
  })

  it('a route that reads the roster before the option fails', () => {
    const src = `${header}
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: 'fixture' })
  if (!crew.ok) return crew.response
  const roster = await getEventRoster(slug, null, {})
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, 'fixture')
  if (foreign) return foreign
  return NextResponse.json(roster)
}`
    expect(stellrOnlyViolations(FIXTURE, src)).toEqual(['GET: reaches getEventRoster before the Stellr-only option'])
  })

  it('a look-alike option from another module fails', () => {
    const src = `${header.replace("from '@/lib/tenancy/load-scoped'", "from '@/lib/elsewhere'")}
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: 'fixture' })
  if (!crew.ok) return crew.response
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, 'fixture')
  if (foreign) return foreign
  return NextResponse.json(await getEventRoster(slug, null, {}))
}`
    expect(stellrOnlyViolations(FIXTURE, src)).toEqual([`GET: ${OPTION} is not the one from ${OPTION_ORIGIN}`])
  })

  it('the same route with the option first passes, through a withAudit wrapper too', () => {
    const src = `${header}
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
export const POST = withAudit(({ args: [req] }: { args: [Request] }) => ({ action: 'x', ...auditSubject(req, 'registrations') }), run)
async function run(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const crew = await requireEventRoute(slug, { route: 'fixture' })
  if (!crew.ok) return crew.response
  noteAuditSubject(req, { userId: crew.userId, tenantId: crew.tenantId, eventSlug: slug })
  const foreign = await stellrOnlyEvent(crew.scope, supabaseServer(), slug, 'fixture')
  if (foreign) return foreign
  return NextResponse.json(await getEventRoster(slug, null, {}))
}`
    expect(stellrOnlyViolations(FIXTURE, src)).toEqual([])
  })
})
