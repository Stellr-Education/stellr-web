-- platform_quota_usage: how much of the Supabase plan's database and storage
-- quota the project is using (S1-quota-alarms, backlog-batch1.23).
--
-- The daily entitlements cron (app/api/cron/entitlements, via lib/quota-alarms.ts)
-- calls this with the service-role client and alerts the admins when either
-- number passes 60% of the plan limit. Until this migration is applied the cron
-- finds the function missing and skips the check without failing.
--
-- SECURITY DEFINER so it can read pg_database_size and sum storage.objects,
-- which the service role cannot do through PostgREST on its own. It returns two
-- numbers and nothing else: no object names, paths or owners.
--
-- Locked down: search_path is empty and every name is schema-qualified, EXECUTE
-- is revoked from public, anon and authenticated (all three, see
-- scripts/check-migration-security.mjs), and granted to service_role only.

create or replace function public.platform_quota_usage()
returns table (database_bytes bigint, storage_bytes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.pg_database_size(pg_catalog.current_database())::bigint as database_bytes,
    (
      select coalesce(pg_catalog.sum((o.metadata ->> 'size')::bigint), 0)::bigint
      from storage.objects as o
    ) as storage_bytes
$$;

comment on function public.platform_quota_usage() is
  'Database size and total storage object bytes, for the 60% quota alarm in the daily entitlements cron. service_role only.';

revoke all on function public.platform_quota_usage() from public, anon, authenticated;
revoke execute on function public.platform_quota_usage() from public, anon, authenticated;
grant execute on function public.platform_quota_usage() to service_role;
