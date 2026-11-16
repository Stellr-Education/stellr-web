import { describe, expect, it } from 'vitest'
import {
  answerSanityQuery,
  assertCanaryCiTarget,
  CANARY_CI_MODE,
  CANARY_CI_STELLR_EVENT,
  canaryCiSwitches,
  canaryCiZone,
  isPlaceholderClerkId,
  judgeCiRun,
  parseRunReport,
  parseSanityRequest,
  placeholderClerkId,
  preflightProblems,
  sanityStubDocs,
  type CanaryRunReport,
} from './canary-ci'
import { CANARY_FLOW_EVENT, planCanaryFlowSeed } from './canary-flow-seed'
import { DEV_SUPABASE_REF } from './e2e-supabase-target'

const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', CLERK_SECRET_KEY: 'sk_test_placeholder', NEXT_PUBLIC_APP_ENV: 'dev' }

describe('assertCanaryCiTarget (WD-8: the local stack only)', () => {
  it('accepts a stack on this machine with a Clerk test key and local origins', () => {
    expect(() => assertCanaryCiTarget(LOCAL, { base: 'http://canary.k11-a.localhost:3000', stellrBase: 'http://localhost:3000', connect: '127.0.0.1' })).not.toThrow()
  })

  it('refuses the hosted dev project, which the K9 runner may use but CI may not', () => {
    expect(() => assertCanaryCiTarget({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_SUPABASE_REF}.supabase.co` })).toThrow(/stack on this machine/)
  })

  it('refuses any other database, and a missing one', () => {
    for (const url of ['https://abcdefghijklmnop.supabase.co', 'http://10.0.0.5:54321', 'http://127.0.0.1.example.com:54321', undefined]) {
      expect(() => assertCanaryCiTarget({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(/refusing/)
    }
  })

  it('refuses any Clerk key that is not a test key', () => {
    for (const key of ['sk_live_placeholder', '', undefined, 'placeholder']) {
      expect(() => assertCanaryCiTarget({ ...LOCAL, CLERK_SECRET_KEY: key })).toThrow(/sk_test_/)
    }
  })

  it('refuses a production app env, as K3 does', () => {
    expect(() => assertCanaryCiTarget({ ...LOCAL, APP_ENV: 'prod' })).toThrow(/refusing/)
  })

  it('refuses an origin or a connect address that is not this machine', () => {
    expect(() => assertCanaryCiTarget(LOCAL, { base: 'https://canary.devzone.example.org' })).toThrow(/--base must be this machine/)
    expect(() => assertCanaryCiTarget(LOCAL, { stellrBase: 'https://stellr-web-dev.vercel.app' })).toThrow(/--stellr-base must be this machine/)
    expect(() => assertCanaryCiTarget(LOCAL, { connect: '10.0.0.5' })).toThrow(/--connect/)
  })
})

describe('the run settings', () => {
  it('makes a zone under .localhost for one run', () => {
    expect(canaryCiZone('12345-1')).toBe('k11-12345-1.localhost')
    expect(canaryCiZone('AB_c!')).toBe('k11-abc.localhost')
    expect(() => canaryCiZone('!!')).toThrow(/empty/)
  })

  it('starts the server with consent ready (its preconditions met) and the stand-in', () => {
    const env = canaryCiSwitches('k11-x.localhost')
    expect(env).toMatchObject({
      CANARY_CI_ZONE: 'k11-x.localhost',
      TENANT_GUARDIAN_CONSENT_ENABLED: 'true',
      LOADSCOPED_MODE: 'enforce',
      TENANT_EVENT_MAIL_ENABLED: 'true',
      AUTHZ_SOURCE: CANARY_CI_MODE.authzSource,
      NEXT_PUBLIC_SANITY_PROJECT_ID: 'k11stub',
    })
    expect(env.LOADSCOPED_MODE).toBe(CANARY_CI_MODE.loadScopedMode)
    // No key, secret or URL among them.
    for (const v of Object.values(env)) expect(v).not.toMatch(/sk_|https?:/)
  })

  it('gives a missing persona a placeholder id, never a real-looking one', () => {
    expect(placeholderClerkId('stellr-probe-admin')).toBe('user_ci_placeholder_stellr_probe_admin')
    expect(isPlaceholderClerkId(placeholderClerkId('canary-admin'))).toBe(true)
    expect(isPlaceholderClerkId('user_2abc')).toBe(false)
  })
})

describe('preflightProblems', () => {
  it('passes when the canary host is mapped and the probe host is unknown', () => {
    expect(preflightProblems({ mapped: 200, unmapped: 404 })).toEqual([])
  })

  it('stops a server that does not map this run\'s zone (another database)', () => {
    expect(preflightProblems({ mapped: 404, unmapped: 404 })[0]).toMatch(/not reading the stack/)
  })

  it('stops on no answer, a server error, or a probe host that answers', () => {
    expect(preflightProblems({ mapped: null, unmapped: null })).toHaveLength(2)
    expect(preflightProblems({ mapped: 503, unmapped: 404 })).toHaveLength(1)
    expect(preflightProblems({ mapped: 200, unmapped: 200 })).toHaveLength(1)
  })
})

describe('the Sanity stand-in', () => {
  const plan = planCanaryFlowSeed({ zone: 'k11-x.localhost', now: new Date('2026-11-16T12:00:00Z') })
  const docs = sanityStubDocs(plan)
  const bySlug = `*[_type == "event" && slug.current == $slug][0] { _id, title }`

  it('serves the canary event on the mirror row\'s dates, and a Stellr event', () => {
    const canary = docs.find((d) => d.slug.current === CANARY_FLOW_EVENT.slug)
    expect(canary?._id).toBe(CANARY_FLOW_EVENT.sanity_id)
    expect(canary?.date).toBe(plan.event.starts_at?.slice(0, 10))
    expect(canary?.endDate).toBe(plan.event.ends_at?.slice(0, 10))
    expect(docs.some((d) => d.slug.current === CANARY_CI_STELLR_EVENT.slug)).toBe(true)
  })

  it('answers an event lookup by slug, and null for anything else', () => {
    expect(answerSanityQuery(bySlug, { slug: CANARY_FLOW_EVENT.slug }, docs)).toMatchObject({ _id: CANARY_FLOW_EVENT.sanity_id })
    expect(answerSanityQuery(bySlug, { slug: 'unknown' }, docs)).toBeNull()
    expect(answerSanityQuery('*[_type == "event"] | order(date asc)', {}, docs)).toBeNull()
    expect(answerSanityQuery('*[_type == "post" && slug.current == $slug][0]', { slug: CANARY_FLOW_EVENT.slug }, docs)).toBeNull()
  })

  it('reads the query and $params from a GET or a POST', () => {
    const get = parseSanityRequest(new URLSearchParams({ query: bySlug, $slug: '"a"', perspective: 'published' }), null)
    expect(get).toEqual({ query: bySlug, params: { slug: 'a' } })
    expect(parseSanityRequest(new URLSearchParams(), JSON.stringify({ query: bySlug, params: { slug: 'b' } }))).toEqual({ query: bySlug, params: { slug: 'b' } })
  })
})

describe('judgeCiRun', () => {
  const report = (over: Partial<CanaryRunReport> = {}): CanaryRunReport => ({
    runId: 'k11run',
    mode: CANARY_CI_MODE,
    results: [
      { id: 'S1', status: 'pass' },
      { id: 'S2', status: 'pass' },
      { id: 'S3', status: 'skipped' },
      { id: 'S4', status: 'pass' },
      { id: 'S7', status: 'fail' },
      { id: 'S8', status: 'pass' },
    ],
    probes: [
      { id: 'P1', verdict: 'pass', persona: 'anonymous' },
      { id: 'P2', verdict: 'skipped', persona: 'canary-manager' },
      { id: 'P3', verdict: 'skipped', persona: 'stellr-probe-admin' },
    ],
    ...over,
  })
  const ALL_MISSING = ['canary-manager', 'canary-admin', 'stellr-probe-admin'] as const

  it('is green with warnings while personas are missing and everything that ran passed', () => {
    const v = judgeCiRun(report(), ALL_MISSING)
    expect(v.ok).toBe(true)
    expect(v.warnings).toHaveLength(2)
    expect(v.lines.at(-1)).toMatch(/green/)
  })

  it('is red when a scenario that needs no persona fails (the deliberately broken S1)', () => {
    const r = report()
    r.results[0] = { id: 'S1', status: 'fail' }
    expect(judgeCiRun(r, ALL_MISSING).ok).toBe(false)
  })

  it('is red when a required scenario is missing from the report', () => {
    expect(judgeCiRun(report({ results: [{ id: 'S1', status: 'pass' }] }), ALL_MISSING).ok).toBe(false)
  })

  it('is red when a probe that ran differs from the table', () => {
    const r = report()
    r.probes[0] = { id: 'P1', verdict: 'differs', persona: 'anonymous' }
    expect(judgeCiRun(r, ALL_MISSING).ok).toBe(false)
  })

  it('is red when a probe is skipped for a reason other than a missing persona', () => {
    const r = report()
    r.probes[0] = { id: 'P1', verdict: 'skipped', persona: 'anonymous' }
    expect(judgeCiRun(r, ALL_MISSING).ok).toBe(false)
    expect(judgeCiRun(report(), ['canary-manager']).ok).toBe(false)
  })

  it('is strict once every persona exists: a skip is never green', () => {
    expect(judgeCiRun(report(), []).ok).toBe(false)
  })

  it('reads only a well-formed report', () => {
    expect(() => parseRunReport({})).toThrow(/not a canary run report/)
    expect(parseRunReport(report()).runId).toBe('k11run')
  })
})
