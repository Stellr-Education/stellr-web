// tenantSupportDb(): reads in an S6 support session (S6-SUP, docs/S6-DESIGN.md section 2).
//
// A platform admin in a support session reads one tenant's data through tenantDb opened
// as tenant_support_ro (supabase/migrations/20261123023124_support_sessions.sql): SELECT
// only, under its own RLS policies on the same transaction-local pin, in a READ ONLY
// transaction. Never the service client: a route that only has a service-client path
// refuses in support mode rather than falling back.
//
// It takes only a session lib/authz/support-session-server.ts verified (the cookie, its
// Clerk binding and the open support_sessions row), and refuses one that has ended. The
// tenant is the session's, never the caller's choice.

import { isVerifiedSupportSession, type ActiveSupportSession } from '@/lib/authz/support-session-server'
import { SUPPORT_ROLE, tenantDb, TenantContextError, type TenantDb, type TenantDbOptions } from './db'

/** tenantDb as tenant_support_ro, pinned to the session's tenant. Throws without a live, verified session. */
export function tenantSupportDb(session: ActiveSupportSession, opts: Pick<TenantDbOptions, 'driver' | 'env'> = {}): TenantDb {
  if (!isVerifiedSupportSession(session)) {
    throw new TenantContextError('tenantSupportDb needs an open support session from loadSupportSession()')
  }
  return tenantDb(session.tenantId, { driver: opts.driver, env: opts.env, role: SUPPORT_ROLE, readOnly: true })
}
