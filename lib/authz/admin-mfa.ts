/**
 * Admins need a second factor on the session (F4 part B, 21 Nov 2026). Built, OFF.
 *
 * With ADMIN_MFA_ENFORCE exactly 'true', an admin principal on a session with no
 * second factor loses its admin role for the request (withoutAdmin), the same
 * way Staff loses Staff without one (staff-role.8, lib/authz/capabilities.ts).
 * Every decision in lib/authz.ts then refuses it: admin API routes answer 403,
 * and the admin pages send it to ADMIN_MFA_PAGE, which asks for two-step
 * verification to be turned on.
 *
 * DO NOT TURN THIS ON until Clerk Pro is bought, MFA is enabled on the
 * production Clerk instance, and every admin has enrolled a second factor. On
 * Clerk's Free plan MFA cannot be enabled at all (refused with
 * unsupported_subscription_plan_features, checked 21 Nov 2026), so nobody can
 * have a second factor and this flag locks every admin out of the portal.
 * docs/ENV-MATRIX.md says the same.
 *
 * DB-free and Clerk-free, like the rest of lib/authz/*: lib/authz.ts hands in
 * the session's second-factor answer. proxy.ts does not use it (no Clerk or
 * database call there, for Vercel Active CPU); the gate is in lib/authz.ts.
 */
import type { Principal } from './decide'

export const ADMIN_MFA_ENV = 'ADMIN_MFA_ENFORCE'

/** Where an admin without a second factor is sent: an /account page, outside the admin shell. */
export const ADMIN_MFA_PAGE = '/account/two-step'

/** Read per request, like the other *_ENFORCE flags. */
export function adminMfaEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env[ADMIN_MFA_ENV] === 'true'
}

/**
 * Pure: does this principal hold an admin role in either source? The 'admin'
 * claim, platform_admins, or a tenant_admin membership in any tenant. Read off
 * every field so the gate needs no source.
 */
export function holdsAdminRole(p: Principal): boolean {
  return !!p.userId && (p.claimsRole === 'admin' || p.platformAdmin || p.memberships.some((m) => m.role === 'tenant_admin'))
}

/**
 * Pure: the principal with every admin role taken away. The 'admin' claim
 * becomes no claim, platform_admins is cleared and tenant_admin memberships go;
 * any other membership (staff, event_manager) stays, so it is decided on its own.
 */
export function withoutAdmin(p: Principal): Principal {
  if (!holdsAdminRole(p)) return p
  return {
    ...p,
    claimsRole: p.claimsRole === 'admin' ? undefined : p.claimsRole,
    platformAdmin: false,
    memberships: p.memberships.filter((m) => m.role !== 'tenant_admin'),
  }
}
