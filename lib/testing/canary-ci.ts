// The canary flow in CI, on the local stack only (S5 wave 8, slice K11; owner
// decision WD-8, default: never the hosted dev database).
//
// CI's `canary-local` job starts a disposable Supabase stack on the runner, as
// e2e-local does, seeds K3's dev-canary tenant into it, serves one build with the
// tenancy switches the canary needs, and runs K8's start phase
// (scripts/canary-tenant-flow.ts --local-stack) against it. scripts/canary-ci.ts
// is the job's driver; this file is what it decides, kept pure so
// lib/testing/canary-ci.test.ts can hold every rule:
//
//   - the target guard: a Supabase stack on this machine and a Clerk test key,
//     and nothing else, with no override (as scripts/seed-e2e-stack.ts refuses);
//     every origin the runner talks to is this machine too;
//   - the server's switches and the run's modes, from one place;
//   - the host preflight that proves, before anything is written, that the server
//     reads the stack this job seeded (the canary host sits under a zone made for
//     this run, so only that stack maps it);
//   - the Sanity stand-in's answers (the canary event has no document in any
//     dataset CI may read, and the production dataset must never get one);
//   - the verdict, with skips for personas the dev Clerk instance does not have yet
//     (K7a creates them, with the owner's yes) reported, not hidden.
//
// No Clerk user is created or changed from CI. A persona Clerk does not have gets
// a placeholder id in the local stack's role rows (so K3's readiness holds) and no
// session (so its scenarios are skipped, and the summary says so).
import { CANARY_SCENARIOS, type ProbeVerdict, type RunMode, type ScenarioId, type ScenarioStatus } from './canary-flow-scenarios'
import {
  assertCanaryFlowTarget,
  CANARY_FLOW_EVENT,
  CANARY_PERSONAS,
  flowTargetEnvFrom,
  normaliseZone,
  type CanaryFlowPlan,
  type CanaryPersonaHandle,
} from './canary-flow-seed'
import { isLoopbackSupabase } from './e2e-supabase-target'

// ── Target ──────────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', 'localhost'])

/** A hostname on this machine: loopback, or any *.localhost name (RFC 6761). */
export function isThisMachineHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return LOOPBACK_HOSTS.has(h) || h.endsWith('.localhost')
}

/**
 * Every guard the CI canary applies before it reads or writes anything. Stricter
 * than K3's (which also allows the hosted dev project, for K9): the database must
 * be a Supabase stack on this machine, the Clerk key a test (sk_test_) key, and
 * every origin and the --connect address this machine. No override (WD-8).
 */
export function assertCanaryCiTarget(
  env: Record<string, string | undefined>,
  opts: { base?: string; stellrBase?: string; connect?: string } = {},
): void {
  if (!isLoopbackSupabase(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error('refusing: the CI canary runs only against a Supabase stack on this machine (WD-8: never the hosted dev database)')
  }
  if (!(env.CLERK_SECRET_KEY ?? '').trim().startsWith('sk_test_')) {
    throw new Error('refusing: the CI canary needs a Clerk test key (sk_test_)')
  }
  assertCanaryFlowTarget(flowTargetEnvFrom(env, false))
  for (const [flag, raw] of [
    ['--base', opts.base],
    ['--stellr-base', opts.stellrBase],
  ] as const) {
    if (raw === undefined) continue
    let host: string
    try {
      host = new URL(raw).hostname
    } catch {
      throw new Error(`${flag} is not a URL`)
    }
    if (!isThisMachineHost(host)) throw new Error(`refusing: ${flag} must be this machine for the CI canary`)
  }
  if (opts.connect !== undefined && !LOOPBACK_ADDRESSES.has(opts.connect.trim().toLowerCase())) {
    throw new Error('refusing: --connect must be this machine (127.0.0.1, ::1 or localhost)')
  }
}

// ── The run's settings ──────────────────────────────────────────────────────

/** Every CI zone starts with this, under .localhost. */
export const CANARY_CI_ZONE_PREFIX = 'k11-'

/**
 * A zone made for one run: k11-<tag>.localhost. Only the stack this job seeds maps
 * canary.<zone>, so a server reading any other database answers it as unknown,
 * and the preflight stops the run before anything is written.
 */
export function canaryCiZone(tag: string): string {
  const clean = tag.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!clean) throw new Error('the zone tag is empty')
  return normaliseZone(`${CANARY_CI_ZONE_PREFIX}${clean}.localhost`)
}

/** The Sanity project id the build and server read: answered by the stand-in, through /etc/hosts. */
export const SANITY_STUB_PROJECT = 'k11stub'
export const SANITY_STUB_HOST = `${SANITY_STUB_PROJECT}.api.sanity.io`

/** A Stellr event that exists only in the stand-in, with no mirror row (so it counts as Stellr's). */
export const CANARY_CI_STELLR_EVENT = { slug: 'canary-ci-stellr-event', sanity_id: 'canary-ci-stellr-event', title: 'Canary CI Stellr Event' } as const

/** The modes the server is started in, and the runner is told. */
export const CANARY_CI_MODE: RunMode = { authzSource: 'clerk', loadScopedMode: 'enforce' }

/**
 * The server's switches, apart from routing (scripts/canary-ci.ts adds that, for
 * the .localhost zone: e2e/tenancy/harness.test.ts keeps the routing variables'
 * names inside lib/tenancy). Guardian consent is on, so S2 to S4 run; it needs
 * LOADSCOPED_MODE=enforce and TENANT_EVENT_MAIL_ENABLED (the readiness guard,
 * lib/registration/eligibility.ts).
 */
export function canaryCiSwitches(zone: string): Record<string, string> {
  return {
    CANARY_CI_ZONE: normaliseZone(zone),
    AUTHZ_SOURCE: CANARY_CI_MODE.authzSource,
    LOADSCOPED_MODE: CANARY_CI_MODE.loadScopedMode,
    TENANT_EVENT_MAIL_ENABLED: 'true',
    TENANT_GUARDIAN_CONSENT_ENABLED: 'true',
    NEXT_PUBLIC_SANITY_PROJECT_ID: SANITY_STUB_PROJECT,
    NEXT_PUBLIC_SANITY_DATASET: 'production',
  }
}

/** The role rows' Clerk id for a persona the dev instance does not have. Never a real id. */
export function placeholderClerkId(handle: CanaryPersonaHandle): string {
  return `user_ci_placeholder_${handle.replace(/-/g, '_')}`
}

export function isPlaceholderClerkId(id: string): boolean {
  return id.startsWith('user_ci_placeholder_')
}

// ── Preflight ───────────────────────────────────────────────────────────────

/**
 * Before the first write: canary.<zone> must answer as a tenant (anything but 404
 * or a server error) and nobody.<zone> as unknown (404). The zone is this run's,
 * so a server on another database fails the first check. null when there was no
 * answer at all.
 */
export function preflightProblems(answers: { mapped: number | null; unmapped: number | null }): string[] {
  const out: string[] = []
  if (answers.mapped === null) out.push('the canary host did not answer')
  else if (answers.mapped === 404) out.push('the canary host answered 404: the server does not map it, so it is not reading the stack this job seeded')
  else if (answers.mapped >= 500) out.push(`the canary host answered ${answers.mapped}`)
  if (answers.unmapped === null) out.push('the unmapped probe host did not answer')
  else if (answers.unmapped !== 404) out.push(`the unmapped probe host answered ${answers.unmapped}, not 404`)
  return out
}

// ── The Sanity stand-in ─────────────────────────────────────────────────────

export interface SanityStubDoc {
  _id: string
  _type: 'event'
  slug: { _type: 'slug'; current: string }
  [key: string]: unknown
}

function eventDoc(id: string, slug: string, title: string, date: string, endDate: string, state: string): SanityStubDoc {
  return {
    _id: id,
    _type: 'event',
    slug: { _type: 'slug', current: slug },
    title,
    activityType: 'live_event',
    date,
    endDate,
    state,
    country: 'US',
    status: 'scheduled',
  }
}

/**
 * The two documents the stand-in serves: the canary event, on the same dates as the
 * mirror row the seed writes (so the age the gate takes matches the runner's), and
 * a Stellr event on the same dates. Registration windows are unset, which for a
 * live event that has not run means open.
 */
export function sanityStubDocs(plan: CanaryFlowPlan): SanityStubDoc[] {
  const start = plan.event.starts_at?.slice(0, 10)
  const end = (plan.event.ends_at ?? plan.event.starts_at)?.slice(0, 10)
  if (!start || !end) throw new Error('the canary event row has no dates')
  return [
    eventDoc(CANARY_FLOW_EVENT.sanity_id, CANARY_FLOW_EVENT.slug, CANARY_FLOW_EVENT.title, start, end, CANARY_FLOW_EVENT.state),
    eventDoc(CANARY_CI_STELLR_EVENT.sanity_id, CANARY_CI_STELLR_EVENT.slug, CANARY_CI_STELLR_EVENT.title, start, end, 'CO'),
  ]
}

/**
 * Whether a GROQ query asks for one document: a `[0]` slice at the top level (not
 * inside a projection, a filter or a function call), as in `*[...][0] {...}` or
 * `*[...] | order(date) [0]`. A range (`[0...3]`) is a list.
 */
export function isSingleDocumentQuery(query: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < query.length; i++) {
    const c = query[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '[' && depth === 0 && /^\[\s*0\s*\]/.test(query.slice(i))) return true
    else if (c === '[' || c === '{' || c === '(') depth++
    else if (c === ']' || c === '}' || c === ')') depth = Math.max(0, depth - 1)
  }
  return false
}

/**
 * What the stand-in answers a GROQ query with. An event looked up by $slug gets
 * its document when it is one of the two, and null otherwise. Every other query
 * gets what lib/sanity.ts returns when Sanity is not configured, so every caller
 * already handles it: null for a single-document query (a top-level `[0]`), and
 * [] for a list (getEventsBySlugs and getEventsByIds return [], and their callers
 * map over the answer). It never evaluates GROQ.
 */
export function answerSanityQuery(query: string, params: Record<string, unknown>, docs: readonly SanityStubDoc[]): unknown {
  const slug = params.slug
  if (typeof slug === 'string' && /_type\s*==\s*"event"/.test(query) && /slug\.current\s*==\s*\$slug/.test(query)) {
    if (isSingleDocumentQuery(query)) return docs.find((d) => d.slug.current === slug) ?? null
    return docs.filter((d) => d.slug.current === slug)
  }
  return isSingleDocumentQuery(query) ? null : []
}

/** The query and its $params from a GET query string or a POST body, as @sanity/client sends them. */
export function parseSanityRequest(search: URLSearchParams, body: string | null): { query: string; params: Record<string, unknown> } {
  if (body) {
    const parsed = JSON.parse(body) as { query?: unknown; params?: unknown }
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      params: parsed.params && typeof parsed.params === 'object' ? (parsed.params as Record<string, unknown>) : {},
    }
  }
  const params: Record<string, unknown> = {}
  for (const [k, v] of search) {
    if (!k.startsWith('$')) continue
    try {
      params[k.slice(1)] = JSON.parse(v)
    } catch {
      params[k.slice(1)] = v
    }
  }
  return { query: search.get('query') ?? '', params }
}

// ── The verdict ─────────────────────────────────────────────────────────────

/** What the runner writes with --result-file: ids and statuses only. */
export interface CanaryRunReport {
  runId: string
  mode: RunMode
  results: { id: ScenarioId; status: ScenarioStatus }[]
  probes: { id: string; verdict: ProbeVerdict; persona: string }[]
}

/** The start phase's scenarios that need no persona: each must pass on every run. */
export const CANARY_CI_REQUIRED: readonly ScenarioId[] = ['S1', 'S2', 'S4', 'S8']

export function parseRunReport(raw: unknown): CanaryRunReport {
  const r = raw as CanaryRunReport
  if (!r || typeof r !== 'object' || typeof r.runId !== 'string' || !Array.isArray(r.results) || !Array.isArray(r.probes)) {
    throw new Error('the result file is not a canary run report')
  }
  return r
}

/**
 * Red or green, and why. Every scenario that needs no persona must pass. With every
 * persona present the run is strict: a skip is never green (as K8 says). While some
 * are missing (before K7a), a scenario or probe skipped for want of one of them is
 * a warning, named in the summary: a scenario only when CANARY_SCENARIOS says it
 * needs one of the missing personas. Any other skip, and anything that ran and
 * differed, is red.
 */
export function judgeCiRun(report: CanaryRunReport, missingPersonas: readonly CanaryPersonaHandle[]): { ok: boolean; lines: string[]; warnings: string[] } {
  const lines: string[] = []
  const warnings: string[] = []
  let ok = true
  const strict = missingPersonas.length === 0
  const fail = (line: string) => {
    ok = false
    lines.push(`  FAIL  ${line}`)
  }
  for (const id of CANARY_CI_REQUIRED) {
    if (!report.results.some((r) => r.id === id)) fail(`${id}: not in the report`)
  }
  for (const r of report.results) {
    if (r.status === 'pass') {
      lines.push(`  PASS  ${r.id}`)
      continue
    }
    const needsNoPersona = CANARY_CI_REQUIRED.includes(r.id)
    if (r.id === 'S7') {
      const differs = report.probes.filter((p) => p.verdict === 'differs')
      const skips = report.probes.filter((p) => p.verdict === 'skipped')
      const unexplained = skips.filter((p) => p.persona === 'anonymous' || !missingPersonas.includes(p.persona as CanaryPersonaHandle))
      if (differs.length) fail(`S7: ${differs.length} probe(s) differ from the table (${differs.map((p) => p.id).join(' ')})`)
      else if (strict || unexplained.length) fail(`S7: ${skips.length} probe(s) skipped${unexplained.length ? ` (${unexplained.map((p) => p.id).join(' ')} not for a missing persona)` : ''}`)
      else {
        warnings.push(`S7: ${skips.length} probe(s) skipped, for personas the dev Clerk instance does not have yet (K7a)`)
        lines.push(`  WARN  S7: ${skips.length} probe(s) skipped for missing personas; the rest match the table`)
      }
      continue
    }
    if (r.status === 'skipped' && !needsNoPersona && !strict) {
      // Only a skip explained by a missing persona is a warning: the scenario must
      // need one of the personas that are missing. Any other skip is red.
      const wanted = CANARY_SCENARIOS.find((s) => s.id === r.id)?.personas ?? []
      const missing = wanted.filter((h) => missingPersonas.includes(h))
      if (missing.length) {
        warnings.push(`${r.id}: skipped, for a persona the dev Clerk instance does not have yet (${missing.join(', ')}; K7a)`)
        lines.push(`  WARN  ${r.id}: skipped (missing persona)`)
        continue
      }
      fail(`${r.id}: skipped, and none of its personas is missing`)
      continue
    }
    fail(`${r.id}: ${r.status}`)
  }
  if (!strict) lines.push(`  Personas missing from the dev Clerk instance: ${missingPersonas.join(', ')} (their scenarios are skipped until K7a)`)
  lines.push(ok ? '  Verdict: green' : '  Verdict: red')
  return { ok, lines, warnings }
}

/** The handles, for the driver. */
export const CANARY_CI_PERSONA_HANDLES: readonly CanaryPersonaHandle[] = CANARY_PERSONAS.map((p) => p.handle)
