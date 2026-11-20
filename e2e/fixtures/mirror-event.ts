// The events-mirror row for an e2e throwaway event (S5 wave 8, ENF prep).
//
// The e2e suites mint events (`e2e-checkin-<hex>`, `e2e-survey-<hex>`, `e2e-artwork-<hex>`,
// `e2e-mentor-cert-<hex>`) that only exist for one test, and write registrations,
// agreements, surveys and the rest under them. The tenancy derivation trigger stamps a
// row's tenant from public.events; with no mirror row it logs `no_event`, and once
// derivation enforces on the dev database it refuses the write. So each fixture mirrors its
// event as Stellr's for the test's life, and removes the row with the rest of its data.
//
// The row's sanity_id is `e2e-mirror.<slug>`, so cleanup can only ever delete a row this
// helper wrote, never a real event's.
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '../../lib/tenancy/constants'

const PREFIX = 'e2e-mirror.'
const E2E_SLUG = /^e2e-[a-z0-9-]+$/

export async function mirrorE2eEvent(db: SupabaseClient, slug: string, title: string): Promise<void> {
  if (!E2E_SLUG.test(slug)) throw new Error(`refusing to mirror a non-e2e slug: ${slug}`)
  const { error } = await db.from('events').insert(
    {
      tenant_id: STELLR_TENANT_ID,
      slug,
      sanity_id: `${PREFIX}${slug}`,
      title,
      starts_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      time_zone: 'UTC',
      country: 'US',
      currency: 'usd',
      grade_system: 'us_grades',
    },
  )
  // A repeat for the same slug is fine; anything else is the fixture's failure.
  if (error && error.code !== '23505') throw new Error(`mirroring e2e event ${slug}: ${error.message}`)
}

export async function unmirrorE2eEvent(db: SupabaseClient, slug: string): Promise<void> {
  if (!E2E_SLUG.test(slug)) return
  await db.from('events').delete().eq('slug', slug).eq('sanity_id', `${PREFIX}${slug}`)
}
