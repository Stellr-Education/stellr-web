-- S6-USE: usage_events and daily roll-ups, aggregates only (docs/PLAN-S6-DRAFT.md,
-- slice 6; docs/S6-DESIGN.md, S6-Q6's default).
--
--   usage_events   one row per counted thing: a tenant, a kind, a time, a count.
--                  No person id, no event key, no free text: nothing in it can
--                  name a person. Written by service_role through
--                  lib/usage/record.ts, and only while USAGE_METERING_ENABLED is
--                  exactly 'true'. Raw rows are kept 90 days.
--   usage_daily    per tenant, per UTC day, per kind: the total. Kept.
--   usage_rollup(day)  writes one day's totals into usage_daily, idempotently:
--                  re-running a day replaces its totals with the same numbers.
--                  Run by the daily usage-rollup cron.
--
-- Kinds: registration, event, email, identity. The first three are recorded at
-- their write points. 'identity' has no single write point (members rows are
-- created in ten places), so usage_rollup counts it from public.members
-- (created_at) instead, under the platform owner's tenant: members is the shared
-- identity table with no tenant_id, and until S7 only Stellr's paths write it (a
-- tenant's registration writes no member rows). The CHECK still allows a recorded
-- 'identity' row, and the roll-up adds the two, so a later write point needs no
-- migration.
--
-- Not SECURITY DEFINER: usage_rollup runs as its caller (service_role), which
-- holds the privileges it needs. EXECUTE is revoked from PUBLIC, anon and
-- authenticated all the same, and granted to service_role only.
--
-- Security: RLS on both tables, no anon/authenticated access, no grant to
-- tenant_app (platform-level although each carries tenant_id:
-- lib/tenancy/tenant-role.ts TENANT_APP_NO_ACCESS_TABLES). service_role gets
-- only what the code uses: usage_events SELECT, INSERT, DELETE (the 90-day
-- purge); usage_daily SELECT, INSERT, UPDATE.
--
-- Locks: two new tables and a function. Nothing live is locked.

SET LOCAL lock_timeout = '5s';

-- ── 1. Raw events ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('registration', 'event', 'email', 'identity')),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  count        integer NOT NULL DEFAULT 1 CHECK (count > 0)
);

-- The roll-up reads one day for every tenant; the purge reads by age.
CREATE INDEX IF NOT EXISTS usage_events_occurred_at_idx ON public.usage_events (occurred_at);
-- Led by tenant_id, as the tenancy lint asks of every table that carries one.
CREATE INDEX IF NOT EXISTS usage_events_tenant_id_idx ON public.usage_events (tenant_id, occurred_at);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
-- service_role too, before its grant: Supabase's default ACL gives it ALL
-- (TRUNCATE included) on a new public table.
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.usage_events TO service_role;
REVOKE ALL ON SEQUENCE public.usage_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.usage_events_id_seq TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access usage_events"
    ON public.usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.usage_events IS
  'S6-USE raw usage counts: tenant, kind, time, count. No personal data. Written by service_role (lib/usage/record.ts) while USAGE_METERING_ENABLED is true; kept 90 days by the usage-rollup cron.';

-- ── 2. Daily roll-ups ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_daily (
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  day         date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('registration', 'event', 'email', 'identity')),
  total       bigint NOT NULL CHECK (total >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, kind)
);

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.usage_daily TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access usage_daily"
    ON public.usage_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.usage_daily IS
  'S6-USE daily usage totals per tenant, UTC day and kind, written by public.usage_rollup(). Kept.';

-- ── 3. The roll-up ────────────────────────────────────────────────────────────
--
-- One UTC day. Sums usage_events for the day per tenant and kind, adds the
-- day's new public.members rows as the owner's 'identity', and upserts the
-- totals. A (tenant, kind) with nothing that day writes no row, so a day whose
-- raw rows were purged keeps the totals rolled up before the purge. A day
-- older than the raw window is refused for the same reason: its raw rows may be
-- partly gone, and re-rolling it would lower a kept total. Returns the number
-- of rows written.

CREATE OR REPLACE FUNCTION public.usage_rollup(p_day date)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- lib/tenancy/constants.ts STELLR_TENANT_ID.
  owner_tenant constant uuid := '00000000-0000-4000-8000-000000000001';
  from_ts timestamptz;
  to_ts   timestamptz;
  written integer;
BEGIN
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'usage_rollup: day is required' USING ERRCODE = '22004';
  END IF;
  IF p_day < (pg_catalog.now() AT TIME ZONE 'UTC')::date - 89 THEN
    RAISE EXCEPTION 'usage_rollup: % is outside the 90-day raw window', p_day USING ERRCODE = '22023';
  END IF;

  from_ts := p_day::timestamp AT TIME ZONE 'UTC';
  to_ts   := (p_day + 1)::timestamp AT TIME ZONE 'UTC';

  WITH src AS (
    SELECT e.tenant_id, e.kind, e.count::bigint AS n
      FROM public.usage_events AS e
     WHERE e.occurred_at >= from_ts AND e.occurred_at < to_ts
    UNION ALL
    SELECT owner_tenant, 'identity', 1::bigint
      FROM public.members AS m
     WHERE m.created_at >= from_ts AND m.created_at < to_ts
  ), totals AS (
    SELECT s.tenant_id, s.kind, pg_catalog.sum(s.n)::bigint AS total
      FROM src AS s
     GROUP BY s.tenant_id, s.kind
  ), upserted AS (
    INSERT INTO public.usage_daily AS d (tenant_id, day, kind, total, updated_at)
    SELECT t.tenant_id, p_day, t.kind, t.total, pg_catalog.now() FROM totals AS t
    ON CONFLICT (tenant_id, day, kind)
      DO UPDATE SET total = EXCLUDED.total, updated_at = EXCLUDED.updated_at
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO written FROM upserted;

  RETURN written;
END;
$$;

COMMENT ON FUNCTION public.usage_rollup(date) IS
  'S6-USE: roll one UTC day of usage_events (and new members as the owner''s identities) into usage_daily. Idempotent. service_role only.';

REVOKE ALL ON FUNCTION public.usage_rollup(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.usage_rollup(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_rollup(date) TO service_role;
