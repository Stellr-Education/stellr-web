-- email_outbox_tenant (S5 wave 8, M7a): which tenant a queued message belongs to.
--
-- B24 (lib/email/outbox.ts) will write tenant_id on every row it queues and
-- drain the outbox per tenant, so one tenant's refused mail cannot hold up
-- another's. Nothing writes or reads the column yet.
--
-- Additive and behaviour-neutral, like cron_runs_tenant (20261105005751) and
-- the S3 expand (20261104130000):
--   * nullable with no default, so adding it is a metadata-only change with no
--     table rewrite, and every existing row and every row today's code writes
--     keeps NULL;
--   * NULL counts as Stellr's (decision WD-2, the safe default: the same rule
--     every derived table follows in log mode). There is no backfill, because
--     a NULL row already means Stellr's;
--   * no derivation trigger: email_outbox has no event key to derive from
--     (lib/tenancy/registry.ts keeps it `system`); the sender that queues the
--     row knows its tenant and B24 supplies it.
--
-- email_outbox stays a system table: tenant_id only labels a row for the drain.
-- Grants are unchanged (service_role only, 20261109224229); tenant_app has none,
-- and tenant_isolation.test.sql asserts that (lib/tenancy/tenant-role.ts
-- TENANT_APP_NO_ACCESS_TABLES).
--
-- lock_timeout: ADD COLUMN needs a brief ACCESS EXCLUSIVE lock. If the outbox
-- cron holds a long transaction, fail fast and retry rather than queue every
-- sender behind this migration.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.email_outbox
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.email_outbox.tenant_id IS
  'The tenant whose sender queued this message. NULL counts as Stellr''s (WD-2). Written by lib/email/outbox.ts from S5 B24.';

-- Backs the per-tenant drain and the ON DELETE RESTRICT check on tenants.
CREATE INDEX IF NOT EXISTS email_outbox_tenant_id_idx
  ON public.email_outbox (tenant_id);
