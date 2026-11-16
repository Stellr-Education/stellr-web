-- tenant_host_map (S5 wave 8, M7b): the host-to-tenant rows the proxy needs,
-- and nothing else (tracker s5-programme.46).
--
-- Today lib/tenancy/host.ts loads the host map by reading tenant_domains joined
-- to tenants with the secret key. B25 will call this function instead, so the
-- proxy can stop holding the secret key for this one read. Nothing calls it yet.
--
-- What it returns: host and tenant id, for hosts whose tenant is active.
-- Suspended, archived and provisioning tenants drop out, so their hosts stay
-- not-found, as HOST_MAP_QUERY filters them today. No other tenant column, and
-- no is_primary or created_at.
--
-- Who may call it: service_role ONLY. Granting it to anon would let anyone with
-- the publishable key list every tenant host in the zone; that surface waits on
-- the owner (decision WD-1). Until WD-1 is accepted, B25 waits too. Accepting it
-- later is one GRANT in a new migration; this function does not change.
--
-- SECURITY DEFINER so that, once WD-1 is accepted, a caller with no grant on
-- tenants or tenant_domains can read exactly these two columns and no more.
-- Locked down per scripts/check-migration-security.mjs: search_path is empty,
-- every name is schema-qualified, and EXECUTE is revoked from public, anon and
-- authenticated before it is granted to service_role.

create or replace function public.tenant_host_map()
returns table (host text, tenant_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.host, d.tenant_id
  from public.tenant_domains as d
  join public.tenants as t on t.id = d.tenant_id
  where t.status = 'active'
$$;

comment on function public.tenant_host_map() is
  'Host -> tenant id for active tenants only, for the proxy host map (S5 B25). service_role only until the owner accepts WD-1.';

revoke all on function public.tenant_host_map() from public, anon, authenticated;
revoke execute on function public.tenant_host_map() from public, anon, authenticated;
grant execute on function public.tenant_host_map() to service_role;
