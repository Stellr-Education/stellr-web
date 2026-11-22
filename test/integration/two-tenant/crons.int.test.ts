// The per-tenant crons on a real database (S5 B26). Run by CI's tenant-db job
// only (vitest.integration.config.mts), on the two-tenant kit and the cron
// fixtures (lib/testing/two-tenant-cron-fixtures.ts). Each cron's route runs as
// Vercel calls it, with its queries going to Postgres through the kit's
// supabase-js stand-in (./rest.ts) as service_role. Proves, for each per-tenant
// cron:
//
//   - every query in one tenant's turn of the run reads and writes only that
//     tenant's rows (the turn is the span between the runner's child cron_runs
//     row for the tenant and its finish, ./rest.ts);
//   - each tenant's work reaches its own rows: the writes the cron makes land on
//     both tenants' fixtures, each in its own turn;
//   - the parent cron_runs row finishes with the result keys the route has always
//     written, plus the per-tenant ledger, and one child row per tenant;
//   - group-invoice-sync runs Stellr alone and records the canary tenant's due row
//     as held, never touching it (fails closed until S9).
//
// What is NOT real here: outside services (Sanity, Resend, Stripe, DocuSign), and
// the survey machinery below runSurveys' per-tenant loop (definitions, planning
// and sending), which have unit tests of their own. Those are stubbed, and each
// stub records whose turn it was called in, so the test still sees which
// tenant's rows reached them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  cronFixtureIds,
  planCronFixtures,
  removeCronFixtures,
  writeCronFixtures,
  type FixtureRow,
  type FixtureTenant,
  type PerTenantCron,
} from '@/lib/testing/two-tenant-cron-fixtures'
import { openTwoTenantKit, type TwoTenantKit } from './kit'
import { AccessLog, restClient } from './rest'

type Row = Record<string, unknown>
interface Call {
  fn: string
  turn: string | null
  arg: unknown
}

const h = vi.hoisted(() => ({
  db: null as unknown,
  log: null as { turn: string | null } | null,
  calls: [] as { fn: string; turn: string | null; arg: unknown }[],
  /** Event dates the stubbed Sanity lookup answers with, by slug. */
  dates: new Map<string, string>(),
  /** Slugs the stubbed survey events list returns: upcoming competitions. */
  upcoming: [] as string[],
}))

function record(fn: string, arg: unknown) {
  h.calls.push({ fn, turn: h.log?.turn ?? null, arg })
}

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => h.db,
  supabaseServerTyped: () => h.db,
  supabase: () => h.db,
}))
vi.mock('@/lib/cron', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/cron')>()), guardCron: () => null }))
vi.mock('@/lib/app-errors', () => ({ reportError: async () => {} }))
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email')>()),
  sendEmail: async (msg: unknown) => {
    h.calls.push({ fn: 'sendEmail', turn: h.log?.turn ?? null, arg: msg })
    return { id: 'placeholder-email-id' }
  },
}))
vi.mock('@/lib/events/repo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/events/repo')>()),
  getEventBySlug: async (slug: string) => (h.dates.has(slug) ? { slug, title: 'Iso event', date: h.dates.get(slug) } : null),
}))
vi.mock('@/lib/survey/events', async (importOriginal) => {
  const surveyEvent = (slug: string) => ({
    slug,
    title: 'Iso event',
    date: h.dates.get(slug) ?? null,
    endDate: h.dates.get(slug) ?? null,
    lastDay: h.dates.get(slug) ?? null,
    timeZone: 'UTC',
    state: null,
    cancelled: false,
    isCampaign: false,
  })
  return {
    ...(await importOriginal<typeof import('@/lib/survey/events')>()),
    loadAllSurveyEvents: async () => h.upcoming.map(surveyEvent),
    loadSurveyEvent: async (slug: string) => (h.upcoming.includes(slug) ? surveyEvent(slug) : null),
  }
})
vi.mock('@/lib/event-emails/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/event-emails/send')>()),
  loadEventForEmail: async (slug: string) => ({ slug, title: 'Iso event', date: h.dates.get(slug) ?? null }),
  sendEventEmail: async (_db: unknown, id: string, opts: unknown) => {
    h.calls.push({ fn: 'sendEventEmail', turn: h.log?.turn ?? null, arg: { id, opts } })
    return { ok: true }
  },
  reclaimStuckSending: async (_db: unknown, _left: unknown, opts: unknown) => {
    h.calls.push({ fn: 'reclaimStuckSending', turn: h.log?.turn ?? null, arg: opts })
    return { reclaimed: 0, errors: [] }
  },
}))
vi.mock('@/lib/event-emails/catch-up', () => ({
  runCatchUps: async (_db: unknown, _date: unknown, _left: unknown, _day: unknown, opts: unknown) => {
    h.calls.push({ fn: 'runCatchUps', turn: h.log?.turn ?? null, arg: opts })
    return { emailed: 0, deferred: 0, errors: [] }
  },
}))
vi.mock('@/lib/event-emails/tenant-mail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/event-emails/tenant-mail')>()),
  // The canary tenant's own sender. Its branding is the kit's, so the lookup is stubbed.
  loadTenantSender: async (_db: unknown, tenantId: string) =>
    tenantId === STELLR_TENANT_ID ? null : { from: 'Iso Canary via Stellr <no-reply@example.test>', replyTo: 'iso-canary@example.test' },
}))
vi.mock('@/lib/esign/outbox', () => ({ drainOutbox: async () => ({ sent: 0, waiting: 0 }) }))
vi.mock('@/lib/esign/heartbeat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esign/heartbeat')>()),
  checkHeartbeat: async () => undefined,
}))
vi.mock('@/lib/esign/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/esign/operations')>()),
  remindEnvelopeRow: async (_db: unknown, env: unknown) => {
    h.calls.push({ fn: 'remindEnvelopeRow', turn: h.log?.turn ?? null, arg: env })
  },
}))
vi.mock('@/lib/docusign-recipients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/docusign-recipients')>()),
  syncEnvelopeRecipients: async () => [],
}))
vi.mock('@/lib/survey/distributions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/survey/distributions')>()),
  applyClock: async () => ({ opened: [], closed: [] }),
  ensureDistribution: async () => ({ action: 'unchanged' }),
  loadDefinition: async () => ({ row: {}, def: {} }),
  planFor: async (_db: unknown, d: unknown) => {
    h.calls.push({ fn: 'planFor', turn: h.log?.turn ?? null, arg: d })
    return { invitable: [], awaitingConsent: [], unreachable: [] }
  },
  materialiseInvitations: async () => 0,
}))
vi.mock('@/lib/survey/send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/survey/send')>()),
  sendQueued: async () => undefined,
  sendReminders: async () => undefined,
}))
vi.mock('@/lib/stripe', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/stripe')>()), stripeClient: () => ({}) }))
vi.mock('@/lib/group-billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/group-billing')>()),
  syncGroupInvoice: async (_db: unknown, _stripe: unknown, id: string) => {
    h.calls.push({ fn: 'syncGroupInvoice', turn: h.log?.turn ?? null, arg: id })
    return 'updated'
  },
}))
vi.mock('@/lib/teacher-share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/teacher-share')>()),
  settleShare: async (_db: unknown, _stripe: unknown, id: string) => {
    h.calls.push({ fn: 'settleShare', turn: h.log?.turn ?? null, arg: id })
    return null
  },
}))

let kit: TwoTenantKit
let plan: FixtureRow[]
let log: AccessLog
let stellr: FixtureTenant
let canary: FixtureTenant
const S = cronFixtureIds('stellr')
const C = cronFixtureIds('canary')

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  kit = await openTwoTenantKit()
  stellr = kit.stellr
  canary = kit.canary
  const tenants = { stellr, canary }
  plan = planCronFixtures(tenants, new Date())
  await removeCronFixtures(kit.admin, plan)
  await writeCronFixtures(kit.admin, plan, tenants)
  log = new AccessLog()
  h.log = log
  h.db = restClient((fn) => kit.service(fn), log) as SupabaseClient
  // Upcoming events five days out; the spare events long past.
  for (const t of [stellr, canary]) {
    h.dates.set(t.event.slug, day(5))
    h.dates.set(t.spare.slug, '2020-01-01')
  }
  h.upcoming = [stellr.event.slug, canary.event.slug]
})

afterAll(async () => {
  if (kit) {
    await removeCronFixtures(kit.admin, plan ?? [])
    await kit.cleanup()
  }
})

beforeEach(() => {
  log.clear()
  h.calls = []
  vi.stubEnv('SURVEY_TOKEN_SECRET', `placeholder-${'x'.repeat(40)}`)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  expect(log.problems, 'queries the stand-in could not translate').toEqual([])
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const tenantOf = (id: string | null) => id ?? STELLR_TENANT_ID

type Route = { GET: (req: never) => Promise<Response> }
const ROUTES: Record<PerTenantCron, () => Promise<Route>> = {
  surveys: () => import('@/app/api/cron/surveys/route'),
  'team-profiles': () => import('@/app/api/cron/team-profiles/route'),
  'survey-retention': () => import('@/app/api/cron/survey-retention/route'),
  'event-emails': () => import('@/app/api/cron/event-emails/route'),
  'docusign-reminders': () => import('@/app/api/cron/docusign-reminders/route'),
  'group-invoice-sync': () => import('@/app/api/cron/group-invoice-sync/route'),
}

/** The route answered 200; otherwise the failure names what it answered. */
async function expectOk(res: Response) {
  const body = res.status === 200 ? '' : await res.text()
  expect(res.status, `answered ${res.status}: ${body.slice(0, 500)}`).toBe(200)
}

/** Calls the route as Vercel's scheduler does (guardCron is stubbed open). */
async function call(job: PerTenantCron): Promise<Response> {
  const { GET } = await ROUTES[job]()
  return GET(new Request(`http://localhost/api/cron/${job}`) as never)
}

async function parentRun(job: string): Promise<Row> {
  const rows = await kit.admin<Row[]>`
    SELECT id::text AS id, finished_at, ok, result, errors FROM public.cron_runs
    WHERE job = ${job} AND parent_id IS NULL ORDER BY started_at DESC LIMIT 1`
  expect(rows, `${job}: no parent cron_runs row`).toHaveLength(1)
  return rows[0]
}

async function childRuns(parentId: string): Promise<Row[]> {
  return kit.admin<Row[]>`
    SELECT tenant_id::text AS tenant_id, finished_at, ok, errors FROM public.cron_runs
    WHERE parent_id = ${parentId}::uuid ORDER BY started_at`
}

/** No query in a tenant's turn read or wrote another tenant's row. */
function expectTurnsIsolated(job: string) {
  const leaks = log.entries
    .filter((e) => e.turn && e.table !== 'cron_runs' && e.table !== 'tenants')
    .flatMap((e) => e.tenants.filter((t) => tenantOf(t) !== e.turn).map((t) => `${e.op} ${e.table} in ${e.turn}'s turn touched a row of ${tenantOf(t)}`))
  expect(leaks, `${job}: cross-tenant access`).toEqual([])
}

/** Both tenants had a turn, Stellr first, and each turn's child row finished ok. */
async function expectTwoTurns(job: string, parent: Row) {
  expect(log.turns, `${job}: turns`).toEqual([STELLR_TENANT_ID, canary.id])
  const children = await childRuns(parent.id as string)
  expect(children.map((c) => c.tenant_id), `${job}: child rows`).toEqual([STELLR_TENANT_ID, canary.id])
  for (const c of children) {
    expect(c.finished_at, `${job}: child ${c.tenant_id} finished`).toBeTruthy()
    expect(c.ok, `${job}: child ${c.tenant_id} ok (errors ${JSON.stringify(c.errors)})`).toBe(true)
  }
}

function expectParent(job: string, parent: Row, keys: string[]) {
  expect(parent.finished_at, `${job}: parent finished`).toBeTruthy()
  expect(parent.ok, `${job}: parent ok (errors ${JSON.stringify(parent.errors)})`).toBe(true)
  const result = parent.result as Row
  for (const k of keys) expect(result, `${job}: result key ${k}`).toHaveProperty(k)
}

const LEDGER_KEYS = ['tenants', 'skipped', 'notReached', 'tenantCursor']

/** Each stub call happened in the turn of the tenant whose row it was given. */
function expectCallsInOwnTurn(fn: string, tenantOfArg: (arg: unknown) => string, expected: number) {
  const calls = h.calls.filter((c) => c.fn === fn)
  expect(calls, `${fn} calls`).toHaveLength(expected)
  for (const c of calls) expect(c.turn, `${fn} for ${tenantOfArg(c.arg)} ran in another tenant's turn`).toBe(tenantOfArg(c.arg))
  return calls
}

const owner = (stellrId: string, canaryId: string) => (id: string) => (id === stellrId ? STELLR_TENANT_ID : id === canaryId ? canary.id : `unknown ${id}`)

describe('surveys', () => {
  it("processes each tenant's open survey in its own turn", async () => {
    const res = await call('surveys')
    await expectOk(res)
    const parent = await parentRun('surveys')
    expectParent('surveys', parent, ['created', 'rescheduled', 'flagged', 'opened', 'closed', 'invited', 'reminded', 'deferred', 'failed', 'quotaHit', 'distributions', ...LEDGER_KEYS])
    await expectTwoTurns('surveys', parent)
    expectCallsInOwnTurn('planFor', (d) => tenantOf((d as Row).tenant_id as string | null), 2)
    const stamped = await kit.admin<Row[]>`
      SELECT id::text AS id, last_run_at FROM public.survey_distributions WHERE id = ANY(${[S.distributionOpen, C.distributionOpen]}::uuid[])`
    expect(stamped.every((r) => r.last_run_at)).toBe(true)
    expect(log.entries.filter((e) => e.op === 'update' && e.table === 'survey_distributions').map((e) => e.turn)).toEqual([STELLR_TENANT_ID, canary.id])
    expectTurnsIsolated('surveys')
  })
})

describe('team-profiles', () => {
  it("creates each tenant's profile in its own turn, sends Stellr's and holds the canary's", async () => {
    const res = await call('team-profiles')
    await expectOk(res)
    const parent = await parentRun('team-profiles')
    expectParent('team-profiles', parent, ['sent', 'failed', 'waiting', 'deferred', ...LEDGER_KEYS])
    await expectTwoTurns('team-profiles', parent)
    const rows = await kit.admin<Row[]>`
      SELECT participant_id::text AS participant_id, tenant_id::text AS tenant_id, send_count, last_send_error
      FROM public.team_profiles WHERE participant_id = ANY(${[S.participant, C.participant]}::uuid[]) ORDER BY tenant_id = ${STELLR_TENANT_ID} DESC`
    expect(rows.map((r) => [r.participant_id, r.tenant_id])).toEqual([
      [S.participant, STELLR_TENANT_ID],
      [C.participant, canary.id],
    ])
    expect(rows[0].send_count).toBe(1)
    // Held, not sent (S5 A10a): another tenant's team profile link waits.
    expect(rows[1].send_count).toBe(0)
    expect(rows[1].last_send_error).toMatch(/^Held/)
    const sends = h.calls.filter((c) => c.fn === 'sendEmail')
    expect(sends.map((c) => c.turn)).toEqual([STELLR_TENANT_ID])
    expect(log.entries.filter((e) => e.op === 'insert' && e.table === 'team_profiles').map((e) => e.turn)).toEqual([STELLR_TENANT_ID, canary.id])
    expectTurnsIsolated('team-profiles')
  })
})

describe('survey-retention', () => {
  it("purges each tenant's due subject in its own turn", async () => {
    vi.stubEnv('SURVEY_RETENTION_APPLY', 'true')
    const res = await call('survey-retention')
    await expectOk(res)
    const parent = await parentRun('survey-retention')
    expectParent('survey-retention', parent, ['apply', 'due', 'dueList', 'waiting', 'inactiveWithoutDate', 'emailsHeld', 'deleted', ...LEDGER_KEYS])
    await expectTwoTurns('survey-retention', parent)
    const purges = log.entries.filter((e) => e.table === 'rpc:survey_purge_person')
    expect(purges.map((e) => [e.turn, (e.rpcArgs as Row).p_participant_ids])).toEqual([
      [STELLR_TENANT_ID, [S.participant]],
      [canary.id, [C.participant]],
    ])
    const left = await kit.admin<Row[]>`SELECT id FROM public.survey_invitations WHERE id = ANY(${[S.invitationOld, C.invitationOld]}::uuid[])`
    expect(left).toEqual([])
    expectTurnsIsolated('survey-retention')
  })
})

describe('event-emails', () => {
  it("sends and skips each tenant's scheduled emails in its own turn", async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const res = await call('event-emails')
    await expectOk(res)
    const parent = await parentRun('event-emails')
    expectParent('event-emails', parent, ['due', 'sent', 'deferred', 'resumed', 'catchUpEmailed', 'catchUpDeferred', 'signingEmailsSent', 'signingEmailsWaiting', ...LEDGER_KEYS])
    await expectTwoTurns('event-emails', parent)
    const sends = expectCallsInOwnTurn('sendEventEmail', (a) => owner(S.emailDue, C.emailDue)((a as Row).id as string), 2)
    // The canary's mail goes from its own sender; Stellr's from Stellr's.
    expect(sends.map((c) => ((c.arg as Row).opts as Row).sender ?? null)).toEqual([null, expect.objectContaining({ replyTo: 'iso-canary@example.test' })])
    expectCallsInOwnTurn('reclaimStuckSending', (a) => (a as Row).tenantId as string, 2)
    expectCallsInOwnTurn('runCatchUps', (a) => (a as Row).tenantId as string, 2)
    const stale = await kit.admin<Row[]>`
      SELECT id::text AS id, status FROM public.event_emails WHERE id = ANY(${[S.emailStale, C.emailStale]}::uuid[]) ORDER BY id`
    expect(stale.map((r) => r.status)).toEqual(['skipped', 'skipped'])
    expect(log.entries.filter((e) => e.op === 'update' && e.table === 'event_emails').map((e) => e.turn)).toEqual([STELLR_TENANT_ID, canary.id])
    expectTurnsIsolated('event-emails')
  })
})

describe('docusign-reminders', () => {
  it("claims and chases each tenant's envelope in its own turn", async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    const res = await call('docusign-reminders')
    await expectOk(res)
    const parent = await parentRun('docusign-reminders')
    expectParent('docusign-reminders', parent, ['processed', 'eligible', 'skippedBounced', 'deferred', 'outbox', ...LEDGER_KEYS])
    await expectTwoTurns('docusign-reminders', parent)
    expectCallsInOwnTurn('remindEnvelopeRow', (a) => tenantOf((a as Row).tenant_id as string | null), 2)
    const claimed = await kit.admin<Row[]>`SELECT reminder_count FROM public.agreements WHERE id = ANY(${[S.agreement, C.agreement]}::uuid[])`
    expect(claimed.map((r) => r.reminder_count)).toEqual([1, 1])
    expect(log.entries.filter((e) => e.op === 'update' && e.table === 'agreements').map((e) => e.turn)).toEqual([STELLR_TENANT_ID, canary.id])
    expectTurnsIsolated('docusign-reminders')
  })
})

describe('group-invoice-sync', () => {
  it("runs Stellr alone, and records the canary tenant's due row as held without touching it", async () => {
    const res = await call('group-invoice-sync')
    await expectOk(res)
    const parent = await parentRun('group-invoice-sync')
    expectParent('group-invoice-sync', parent, ['updated', 'share_settled', 'share_not_due', 'share_refunds', 'share_refunds_failed', 'tenantHeld'])
    expect((parent.result as Row).tenantHeld).toBe(1)
    // Stellr alone is the runner's plain call: no child rows, no ledger, no turns.
    expect(await childRuns(parent.id as string)).toEqual([])
    expect(parent.result).not.toHaveProperty('tenants')
    expect(log.turns).toEqual([])
    expect(h.calls.filter((c) => c.fn === 'syncGroupInvoice').map((c) => c.arg)).toEqual([S.registration])
    // Stellr's two passes read Stellr's rows only; the held counts are head counts
    // after them, which fetch no row but count the canary's.
    const reads = log.entries.filter((e) => e.table === 'registrations' && e.op === 'select')
    expect(reads.length).toBeGreaterThanOrEqual(2)
    for (const r of reads.slice(0, 2)) expect(r.tenants.map(tenantOf).filter((t) => t !== STELLR_TENANT_ID)).toEqual([])
    const counts = log.entries.filter((e) => e.table === 'registrations' && e.op === 'count')
    expect(counts.length).toBeGreaterThanOrEqual(2)
    expect(counts.flatMap((r) => r.tenants)).toContain(canary.id)
    // Nothing was written to the canary's registration: it stays due for S9.
    expect(log.entries.filter((e) => e.op !== 'select' && e.op !== 'count' && e.tenants.includes(canary.id))).toEqual([])
    const [held] = await kit.admin<Row[]>`SELECT invoice_sync_due_at FROM public.registrations WHERE id = ${C.registration}::uuid`
    expect(held.invoice_sync_due_at).toBeTruthy()
  })
})
