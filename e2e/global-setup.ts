import { createClerkClient } from '@clerk/backend'
import { clerkSetup } from '@clerk/testing/playwright'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseFetch, supabaseSecretKey } from '../lib/supabase-keys'
import { assertE2eSupabase } from '../lib/testing/e2e-supabase-target'
import { removeSurveyEvent } from './fixtures/survey'
import { FIXTURES } from './fixtures/users'

/**
 * Two checks before any spec runs, plus Clerk's testing setup and two pieces of
 * database housekeeping.
 *
 * 1. Refuse production.
 * 2. Refuse a target that is not actually serving this app.
 * 3. Remove `e2e-survey-*` events a cancelled run left behind (deps-tailwind4.6).
 * 4. Make sure the event-manager fixture is linked and assigned (event-manager-e2e.4).
 *
 * The second exists because of a false green on 10 Sept. The dev deployment sits
 * behind Vercel Authentication, so every request 302'd to vercel.com/sso-api and
 * the suite spent its run asserting against `<title>Login – Vercel</title>`.
 * That page has an <h1> and logs no console errors, so twenty-one checks passed
 * while testing nothing at all.
 *
 * A suite that cannot tell the difference between the app and a login wall is
 * worse than no suite, because it reports confidence it has not earned. So the
 * target is probed once, up front, and anything that is not this app is a hard
 * failure rather than a green run.
 */
const FORBIDDEN_HOSTS = [
  'www.stellreducation.org',
  'app.stellreducation.org',
  'stellreducation.org',
  'stellr-web.vercel.app',
  'stellr-web-stellreducation.vercel.app',
  'stellr-web-git-main-stellreducation.vercel.app',
]

export default async function globalSetup() {
  // The specs' fixtures write with the secret key, so check the database as
  // well as the app. Unset is fine: a run against a deployment holds no
  // database settings of its own.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) assertE2eSupabase()

  // Exchanges the secret key for a testing token, so auth.setup.ts can sign in
  // without meeting Clerk's bot-detection and new-device challenges.
  if (process.env.CLERK_SECRET_KEY) await clerkSetup()

  // deep review TEST-11: previously this returned early with no E2E_BASE_URL, so
  // the "is this actually our app, on the host we asked for?" probe ran only
  // against deployments and never locally — exactly where the 10 Sept
  // redirect-to-production false green happened. Default to the local server the
  // config starts and always probe. The webServer is up before globalSetup runs,
  // and when NEXT_PUBLIC_SITE_URL points at localhost (scripts/dev.mjs and CI
  // both set it) the probe stays on-host and finds the app; if a stale .env.local
  // still points at production, proxy.ts redirects off localhost and the probe
  // now catches it instead of silently testing www.
  const raw = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: ${raw}`)
  }

  if (FORBIDDEN_HOSTS.includes(url.host)) {
    throw new Error(
      `\nRefusing to run the E2E suite against production (${url.host}).\n\n` +
        'These tests sign in as fixture members and write rows. Point\n' +
        'E2E_BASE_URL at the dev deployment or a preview URL instead.\n',
    )
  }

  if (url.host.endsWith('.stellreducation.org')) {
    throw new Error(
      `\nRefusing to run against ${url.host} — a stellreducation.org host that is\n` +
        'not a known dev target.\n',
    )
  }

  await assertServingTheApp(url)

  // Only once the target is known to be this app, and only against the dev
  // project or a stack on this machine (assertE2eSupabase above).
  const db = e2eDatabase()
  if (db) {
    await removeStaleSurveyEvents(db)
    await removeStaleMirrorRows(db)
    await ensureEventManagerFixture(db)
  }
}

/**
 * The secret-key client the fixtures use, or null when this run holds no
 * database settings (a run against a deployment). Throws for any database the
 * suite may not write to, as the fixtures do.
 */
function e2eDatabase(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null
  const key = supabaseSecretKey()
  if (!key) {
    console.log('global-setup: no Supabase secret key, so survey cleanup and the event-manager fixture are skipped.')
    return null
  }
  return createClient(assertE2eSupabase(), key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

// ── Leftover survey events (deps-tailwind4.6) ────────────────────────────────
//
// survey-cli.ts makes a throwaway `e2e-survey-<8 hex>` event per test and the
// spec removes it afterwards. A newer push to a PR cancels that PR's running
// suite, afterEach never runs, and the event stays, with a COMPLETED agreement
// for the seed member. An hour is far longer than any suite runs, so an event
// that old belongs to no running test. It goes through the fixture's own
// `remove`, which refuses any other slug, and the pattern here is checked first.

export const SURVEY_EVENT_SLUG = /^e2e-survey-[0-9a-f]{8}$/
const STALE_AFTER_MS = 60 * 60 * 1000

/** Slugs whose every row is older than the cutoff. Anything not matching SURVEY_EVENT_SLUG is ignored. */
export function staleSurveySlugs(rows: { event_slug: string | null; created_at: string }[], cutoff: number): string[] {
  const newest = new Map<string, number>()
  for (const r of rows) {
    if (!r.event_slug || !SURVEY_EVENT_SLUG.test(r.event_slug)) continue
    const at = Date.parse(r.created_at)
    newest.set(r.event_slug, Math.max(newest.get(r.event_slug) ?? 0, Number.isNaN(at) ? Infinity : at))
  }
  return [...newest].filter(([, at]) => at < cutoff).map(([slug]) => slug).sort()
}

async function removeStaleSurveyEvents(db: SupabaseClient) {
  const rows: { event_slug: string | null; created_at: string }[] = []
  for (const table of ['registrations', 'survey_distributions']) {
    const { data, error } = await db.from(table).select('event_slug, created_at').like('event_slug', 'e2e-survey-%')
    if (error) throw new Error(`global-setup: reading ${table} for leftover survey events: ${error.message}`)
    rows.push(...(data ?? []))
  }
  const stale = staleSurveySlugs(rows, Date.now() - STALE_AFTER_MS)
  for (const slug of stale) removeSurveyEvent(slug)
  console.log(`global-setup: removed ${stale.length} leftover e2e-survey event${stale.length === 1 ? '' : 's'} older than an hour.`)
}

// S5 wave 8 (ENF prep): an e2e event's events-mirror row (e2e/fixtures/mirror-event.ts) left by
// a cancelled run, an hour old or more. Only rows that helper wrote (sanity_id e2e-mirror.*).
async function removeStaleMirrorRows(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString()
  const { data, error } = await db.from('events').delete().like('sanity_id', 'e2e-mirror.%').lt('created_at', cutoff).select('slug')
  if (error) throw new Error(`global-setup: removing leftover e2e mirror rows: ${error.message}`)
  console.log(`global-setup: removed ${data?.length ?? 0} leftover e2e events-mirror row${data?.length === 1 ? '' : 's'}.`)
}

// ── Event-manager fixture (event-manager-e2e.4) ──────────────────────────────
//
// access-control.spec.ts proves an event manager reaches its one event and is
// refused another. That needs members.clerk_user_id on the fixture's row and an
// event_manager_assignments row, both keyed on the fixture's Clerk user id,
// which is specific to the Clerk development instance and so is never committed
// (supabase/seed.sql). They were applied to dev by hand; a reseeded database lost
// them. So look the user up by its fixture address and write both, idempotently.
// scripts/seed-e2e-stack.ts does the same for the e2e-local stack.

const EVENT_MANAGER_EVENT = 'seed-regional-challenge'

async function ensureEventManagerFixture(db: SupabaseClient) {
  const fixture = FIXTURES.event_manager
  const required = Boolean(process.env[fixture.passwordVar])
  const clerkKey = process.env.CLERK_SECRET_KEY
  // A live instance's user ids never belong in the e2e database.
  if (!clerkKey?.startsWith('sk_test_')) {
    console.log('global-setup: no Clerk test key, so the event-manager fixture is left as it is.')
    return
  }

  const { data: users } = await createClerkClient({ secretKey: clerkKey }).users.getUserList({ emailAddress: [fixture.email] })
  const user = users[0]
  if (!user) {
    // A fixture nobody has a password for skips its own spec. One that can sign
    // in but is not linked would fail it with a misleading error.
    if (required) throw new Error(`global-setup: no Clerk user for the event_manager fixture, but ${fixture.passwordVar} is set.`)
    console.log('global-setup: event_manager fixture not provisioned in Clerk, left unlinked.')
    return
  }

  const { data: member, error: readError } = await db.from('members').select('clerk_user_id').eq('id', fixture.memberId).maybeSingle()
  if (readError) throw new Error(`global-setup: reading the event_manager member row: ${readError.message}`)
  if (!member) {
    if (required) throw new Error('global-setup: the event_manager member row from supabase/seed.sql is missing.')
    console.log('global-setup: no event_manager member row, left unlinked.')
    return
  }
  if (member.clerk_user_id !== user.id) {
    const { error, count } = await db.from('members').update({ clerk_user_id: user.id }, { count: 'exact' }).eq('id', fixture.memberId)
    if (error) throw new Error(`global-setup: linking the event_manager member row: ${error.message}`)
    if (count !== 1) throw new Error(`global-setup: linking the event_manager member row updated ${count} rows, expected one.`)
  }

  const { error: assignError } = await db
    .from('event_manager_assignments')
    .upsert({ clerk_user_id: user.id, event_slug: EVENT_MANAGER_EVENT }, { onConflict: 'clerk_user_id,event_slug', ignoreDuplicates: true })
  if (assignError) throw new Error(`global-setup: assigning the event_manager fixture: ${assignError.message}`)
  console.log(`global-setup: event_manager fixture ${member.clerk_user_id === user.id ? 'already linked' : 'linked'}, assigned to ${EVENT_MANAGER_EVENT}.`)
}

async function assertServingTheApp(url: URL) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

  // Header only — deliberately NOT 'x-vercel-set-bypass-cookie'.
  //
  // That header makes Vercel answer 307 -> '/' so it can set the _vercel_jwt
  // cookie on the redirect. A browser keeps the cookie and the second request
  // succeeds; `fetch` does not, so it re-requests '/', is redirected again, and
  // loops until Node gives up with "redirect count exceeded" — which this file
  // then reported as "the deployment never built". The target was healthy the
  // whole time. The cookie is only useful where something retains it, which is
  // the browser context in e2e/fixtures/test.ts, not these probes.
  const headers: Record<string, string> = bypass
    ? { 'x-vercel-protection-bypass': bypass }
    : {}

  let response: Response
  try {
    response = await fetch(url.toString(), { headers, redirect: 'manual' })
  } catch (error) {
    throw new Error(`\nCould not reach ${url.host}: ${(error as Error).message}\n`)
  }

  const location = response.headers.get('location') ?? ''

  if (location.includes('vercel.com/sso-api')) {
    throw new Error(
      `\n${url.host} is behind Vercel Authentication — every request redirects to\n` +
        'a Vercel login page, so the suite would assert against that instead of\n' +
        'the app and report a meaningless green.\n\n' +
        'Fix by generating a bypass token:\n' +
        '  Vercel → stellr-web-dev → Settings → Deployment Protection →\n' +
        '  Protection Bypass for Automation → generate, then set\n' +
        '  VERCEL_AUTOMATION_BYPASS_SECRET in .env.local and in CI.\n\n' +
        (bypass
          ? '  VERCEL_AUTOMATION_BYPASS_SECRET is set but was not accepted —\n' +
            '  regenerate it, or confirm it belongs to this project.\n'
          : '  VERCEL_AUTOMATION_BYPASS_SECRET is not currently set.\n'),
    )
  }

  if (response.status >= 400) {
    throw new Error(`\n${url.host} returned ${response.status} for /. Nothing to test against.\n`)
  }

  // Positive identification, not absence of known-bad pages.
  //
  // Twice now this suite has reported a confident green while pointed at
  // something that was not the app: first a Vercel login page, then Vercel's
  // "Deployment is building" placeholder shown because the deployment sat
  // QUEUED and never built. Both have an <h1> and neither logs app console
  // errors, so every visual assertion passed.
  //
  // Enumerating those two would just wait for a third. So the target must
  // positively identify as this app before any spec runs.
  let body: string
  try {
    const followed = await fetch(url.toString(), { headers, redirect: 'follow' })

    // Did we stay on the host we were asked to test?
    //
    // WHY (10 Sept 2026): with NEXT_PUBLIC_SITE_URL unset, lib/env.ts falls back
    // to the production origins and proxy.ts correctly redirects localhost's
    // public routes to www.stellreducation.org. The smoke suite followed the
    // redirect and asserted a non-error status and one <h1> — both true of the
    // live site — so it passed while never loading local code at all.
    //
    // Nothing above catches that: the target is reachable, is not a Vercel
    // placeholder, is not a login page, and DOES contain "Stellr". It is simply
    // the wrong deployment. Identity has to include the host, not just the app.
    const landed = new URL(followed.url)
    if (landed.host !== url.host) {
      throw new Error(
        `\n${url.host} redirects to ${landed.host} — the suite would test that\n` +
          'instead, and report a green for a deployment nobody asked about.\n\n' +
          (/stellreducation\.org$/.test(landed.host)
            ? 'That is PRODUCTION. Almost always NEXT_PUBLIC_SITE_URL and\n' +
              'NEXT_PUBLIC_AUTH_APP_URL are unset, so lib/env.ts falls back to the\n' +
              'production origins and proxy.ts redirects off localhost.\n\n' +
              `Fix: set both to http://${url.host} in .env.local — \`npm run dev\`\n` +
              'now writes them for you.\n'
            : 'Set NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_AUTH_APP_URL to match the\n' +
              'host actually being tested.\n'),
      )
    }

    body = await followed.text()
  } catch (error) {
    // Our own diagnostics are already phrased for a human; only transport
    // failures need interpreting below.
    if (error instanceof Error && error.message.startsWith('\n')) throw error

    const cause = (error as { cause?: Error }).cause?.message ?? (error as Error).message
    if (/redirect count exceeded/i.test(cause)) {
      throw new Error(
        `\n${url.host} is stuck in a redirect loop.\n\n` +
          'NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_AUTH_APP_URL most likely disagree\n' +
          'with the host actually serving the request, so proxy.ts redirects a\n' +
          'public route to itself. Compare all three.\n\n' +
          'Note this is NOT how an unbuilt deployment presents — that serves a\n' +
          'Vercel placeholder and is reported separately below.\n',
      )
    }
    throw new Error(`\nCould not read ${url.host}: ${cause}\n`)
  }

  if (/Deployment is building|DEPLOYMENT_NOT_FOUND|Deployment has failed/i.test(body)) {
    throw new Error(
      `\n${url.host} is serving a Vercel placeholder, not the app — the deployment\n` +
        'is still building, missing, or failed. Wait for it to be READY, then re-run.\n',
    )
  }

  if (!/Stellr/i.test(body)) {
    throw new Error(
      `\n${url.host} does not look like this app: its home page never mentions\n` +
        '"Stellr". Refusing to run — a suite that cannot tell the app from a\n' +
        'placeholder reports confidence it has not earned.\n',
    )
  }
}
