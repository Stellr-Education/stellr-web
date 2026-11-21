// The tenant of a registration, for a ledger row written beside it (S5 wave 8, Lane C
// optional-event writers). event_refunds and the other tables in scripts/s5-inventory.mjs
// OPTIONAL_EVENT_TABLES derive their tenant from a nullable event_slug, so a row written
// without one gets none once derivation enforces. The writer supplies the registration's
// tenant, which is the one the trigger would derive from its event (a registration's own
// tenant comes from the same event), so supplying it never conflicts.
//
// A NULL tenant_id is a Stellr row the backfill has not reached, as everywhere in S5. A failed
// read, or no registration, answers null: the caller then writes tenant_id NULL, which is what
// it wrote before, and the trigger decides as it did. A refund already made is never held back
// for want of this read.
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from './constants'

export async function loadRegistrationTenantId(db: SupabaseClient, registrationId: string | null | undefined): Promise<string | null> {
  if (!registrationId) return null
  try {
    const { data, error } = await db.from('registrations').select('tenant_id').eq('id', registrationId).maybeSingle()
    if (error || !data) return null
    return (data as { tenant_id?: string | null }).tenant_id ?? STELLR_TENANT_ID
  } catch {
    return null
  }
}
