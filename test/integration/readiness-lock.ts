// The readiness lock (S5 .32, supabase/migrations/20261122020000_tenancy_readiness_lock.sql)
// refuses an active tenant other than the platform owner until tenancy_settings.tenants_ready_at
// is set. The integration fixtures run on CI's local database outside a transaction, so they
// open the lock before they insert their tenants and put it back as they found it afterwards.
import type postgres from 'postgres'

const NOTE = 'integration fixture (CI local database)'

/** Opens the lock if it is closed. The returned function closes it again, only if this opened it. */
export async function openReadinessLock(admin: postgres.Sql): Promise<() => Promise<void>> {
  const [row] = await admin<{ was_closed: boolean }[]>`
    WITH before AS (SELECT tenants_ready_at IS NULL AS was_closed FROM public.tenancy_settings WHERE id)
    UPDATE public.tenancy_settings
       SET tenants_ready_at = coalesce(tenants_ready_at, now()),
           tenants_ready_note = coalesce(tenants_ready_note, ${NOTE})
     WHERE id
    RETURNING (SELECT was_closed FROM before) AS was_closed`
  if (!row?.was_closed) return async () => {}
  // Run after the fixture's tenants are deleted: the guard refuses to close the lock while
  // another tenant is still active, and a failure here is left for the next run to find.
  return async () => {
    await admin`UPDATE public.tenancy_settings SET tenants_ready_at = NULL, tenants_ready_note = NULL WHERE id AND tenants_ready_note = ${NOTE}`
  }
}
