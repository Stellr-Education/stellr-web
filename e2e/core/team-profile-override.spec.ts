import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'
import { freshClerkSession } from '../fixtures/fresh-session'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Team profile override (30 Oct 2026): staff let Auto-Assign place a student
 * who hasn't submitted a team profile, and the Team profiles panel shows them
 * as "Overridden" with who did it and when. Closes tracker row
 * team-profile-override.3.
 *
 * The admin overrides the seed student Ada on the seed event, then undoes it.
 * It goes through the companies API the panel's Override and Undo override
 * buttons call (components/admin/EventTeamProfiles.tsx), and checks the
 * participant columns the panel's pill is drawn from: loadCompanyPlan
 * (lib/team-profile/assign.ts) reads team_profile_overridden_at as
 * `overridden`, which turns the pill to "Overridden", and
 * team_profile_overridden_by_name for the "by …" line beneath it.
 *
 * Not the roster tab itself: it lives on /admin/competitions/[slug], which reads
 * the event from Sanity and answers 404 without it, and CI runs this suite with
 * NEXT_PUBLIC_SANITY_PROJECT_ID unset.
 *
 * Ada's participant row is a shared dev seed row (supabase/seed.sql), so the
 * override is cleared before and after the test in hooks: a failure part-way
 * cannot leave her overridden for the next run or another spec.
 */

test.use({ storageState: storageStatePath('admin') })

const SLUG = 'seed-regional-challenge'
const ADA = '00000000-0000-4000-e000-000000000001' // participants, supabase/seed.sql
const RAVI = '00000000-0000-4000-e000-000000000002' // her teammate, same registration
const COMPANIES = `/api/admin/events/${SLUG}/companies`
const COLUMNS = 'id, team_profile_overridden_at, team_profile_overridden_by, team_profile_overridden_by_name'

interface OverrideRow {
  id: string
  team_profile_overridden_at: string | null
  team_profile_overridden_by: string | null
  team_profile_overridden_by_name: string | null
}

function db(): SupabaseClient {
  return createClient(assertE2eSupabase(), supabaseSecretKey() as string, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  })
}

async function overrideOf(id: string): Promise<OverrideRow> {
  const { data, error } = await db().from('participants').select(COLUMNS).eq('id', id).single()
  expect(error, `reading participant ${id}: ${error?.message}`).toBeNull()
  return data as OverrideRow
}

async function clearAdaOverride() {
  const { error } = await db()
    .from('participants')
    .update({ team_profile_overridden_at: null, team_profile_overridden_by: null, team_profile_overridden_by_name: null })
    .eq('id', ADA)
  expect(error, `clearing Ada's override: ${error?.message}`).toBeNull()
}

test.beforeEach(clearAdaOverride)
test.afterEach(clearAdaOverride)

test('an admin overrides a seed student, who shows as overridden by them, and undoes it', async ({ page, baseURL }) => {
  // A page that loads Clerk, and a fresh token minted on it, before the API calls
  // (fixtures/fresh-session.ts).
  await page.goto('/admin')
  expect(new URL(page.url()).origin, '/admin was served from another host').toBe(new URL(baseURL!).origin)
  await freshClerkSession(page)

  const ravi = await overrideOf(RAVI)
  expect((await overrideOf(ADA)).team_profile_overridden_at).toBeNull()

  // Override: the panel's "Override" button on Ada's row.
  const started = Date.now()
  const res = await page.request.post(COMPANIES, { data: { action: 'override', participantId: ADA, overridden: true } })
  expect(res.status(), await res.text()).toBe(200)

  // What the pill reads: overridden, by the signed-in admin, just now.
  const overridden = await overrideOf(ADA)
  expect(overridden.team_profile_overridden_at).not.toBeNull()
  expect(Date.parse(overridden.team_profile_overridden_at!)).toBeGreaterThanOrEqual(started - 60_000)
  expect(overridden.team_profile_overridden_by).toMatch(/^user_/)
  expect(overridden.team_profile_overridden_by_name?.trim()).toBeTruthy()
  // One student, not her registration: her teammate is as he was.
  expect(await overrideOf(RAVI)).toEqual(ravi)

  // The override is confined to this event's students (AUTH-3): an id that is
  // not on its roster is refused and nothing is written.
  const stranger = await page.request.post(COMPANIES, { data: { action: 'override', participantId: randomUUID(), overridden: true } })
  expect(stranger.status(), await stranger.text()).toBe(404)

  // Undo: the "Undo override" button on the same row.
  const undo = await page.request.post(COMPANIES, { data: { action: 'override', participantId: ADA, overridden: false } })
  expect(undo.status(), await undo.text()).toBe(200)
  expect(await overrideOf(ADA)).toEqual({
    id: ADA,
    team_profile_overridden_at: null,
    team_profile_overridden_by: null,
    team_profile_overridden_by_name: null,
  })
})
