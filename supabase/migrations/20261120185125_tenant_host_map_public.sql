-- tenant_host_map, public (S5 wave 8, B25; decision WD-1 accepted 20 Nov 2026).
--
-- The owner accepted that anyone holding the publishable key may list the
-- active tenant hosts in the zone (hosts are public DNS in any case). So the
-- proxy (lib/tenancy/host.ts) can load its host map with the publishable key
-- and stop holding the secret key for this read.
--
-- Two changes to M7's function (20261116190926_tenant_host_map):
--   * it also returns the tenant's slug, which the proxy's host map carries
--     (tenantSlug) and M7's two columns could not give it;
--   * EXECUTE goes to anon as well as service_role. authenticated, tenant_app
--     and public stay refused: the proxy calls it with the publishable key and
--     no user token, so anon is the only role it needs.
--
-- Still only active tenants, still host, tenant id and slug and nothing else.
-- A changed return type cannot be replaced in place, so the function is
-- dropped and created again, in one transaction with its grants. Nothing in
-- the database depends on it, and no deployed code calls it yet.
--
-- Locked down per scripts/check-migration-security.mjs: SECURITY DEFINER with
-- an empty search_path, every name schema-qualified, EXECUTE revoked from
-- public, anon and authenticated before the two grants.

drop function if exists public.tenant_host_map();

create function public.tenant_host_map()
returns table (host text, tenant_id uuid, tenant_slug text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.host, d.tenant_id, t.slug
  from public.tenant_domains as d
  join public.tenants as t on t.id = d.tenant_id
  where t.status = 'active'
$$;

comment on function public.tenant_host_map() is
  'Host -> tenant id and slug, active tenants only, for the proxy host map (S5 B25). anon and service_role may call it (WD-1, accepted 20 Nov 2026).';

revoke all on function public.tenant_host_map() from public, anon, authenticated;
revoke execute on function public.tenant_host_map() from public, anon, authenticated;
grant execute on function public.tenant_host_map() to anon, service_role;
