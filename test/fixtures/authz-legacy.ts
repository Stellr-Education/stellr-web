// The legacy guards as they stood before S5 C14, frozen word for word.
//
// C14 re-implemented lib/admin-auth.ts over lib/authz. The equivalence harnesses compare
// lib/authz with the legacy answers, so with the live module on the legacy side they would
// compare lib/authz with itself and could not fail. They run this copy instead, and
// lib/authz/equivalence.test.ts holds the live module to it as well.
//
// Never edit the logic here to make a test pass: this file is what "today's answers" means.
//
// S5 C25 batch 4 (21 Nov 2026) deleted the live helpers, and lib/event-access.ts with them.
// requireEventAccess is frozen at the foot of this file as it stood before C25 batch 3B. The
// one user left is the codemod's equivalence proof (scripts/codemods/authz.equivalence.test.ts):
// the codemod still rewrites these idioms, so it still needs them to compare against.
// lib/authz/equivalence.test.ts pins lib/authz's own table now, with Staff in it.
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { activeAssignmentFilter } from '@/lib/event-manager-active'

type Claims = Record<string, unknown> | null | undefined

export const DUTY_SCOPES = ['all', 'events', 'memberships', 'community', 'academy', 'graduations'] as const
export type DutyScope = (typeof DUTY_SCOPES)[number]

function roleFromClaims(sessionClaims: Claims): string | undefined {
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role
}

export function isAdminClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'admin'
}

export function isEventManagerClaims(sessionClaims: Claims): boolean {
  return roleFromClaims(sessionClaims) === 'event_manager'
}

export const CREW_CLERK_ROLES = ['admin', 'event_manager'] as const

export function isCrewRole(role: unknown): boolean {
  return typeof role === 'string' && (CREW_CLERK_ROLES as readonly string[]).includes(role)
}

export async function currentUserIsAdmin(): Promise<boolean> {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export function hasAdminPortalAccess(sessionClaims: Claims): boolean {
  return isAdminClaims(sessionClaims) || isEventManagerClaims(sessionClaims)
}

export async function requireAdminPage(): Promise<void> {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')
  if (!hasAdminPortalAccess(sessionClaims)) notFound()
}

export async function currentUserHasScope(scope: DutyScope): Promise<boolean> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return false
  if (isAdminClaims(sessionClaims)) return true

  const db = supabaseServer()
  const { data: member } = await db.from('members').select('id').eq('clerk_user_id', userId).maybeSingle()
  if (!member) return false

  const { data } = await db.from('admin_duties').select('scopes').eq('member_id', member.id).maybeSingle()
  const scopes = (data?.scopes as string[] | null) ?? []
  return scopes.includes('all') || scopes.includes(scope)
}

// lib/event-access.ts, as it stood before S5 C25 batch 3B, word for word.
async function getAssignedEventSlugs(clerkUserId: string): Promise<string[]> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('event_manager_assignments')
    .select('event_slug')
    .eq('clerk_user_id', clerkUserId)
    // Expired grants give no access, even before the daily sweep deletes them.
    .or(activeAssignmentFilter())
  if (error) throw new Error(`Failed to load event assignments: ${error.message}`)
  return (data ?? []).map((row) => row.event_slug)
}

export type EventAccess =
  | { ok: true; userId: string; isAdmin: boolean; assignedSlugs: string[] | null } // null = all events
  | { ok: false; status: 401 | 403 }

export async function requireEventAccess(eventSlug?: string): Promise<EventAccess> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return { ok: false, status: 401 }

  if (isAdminClaims(sessionClaims)) {
    return { ok: true, userId, isAdmin: true, assignedSlugs: null }
  }

  if (!isEventManagerClaims(sessionClaims)) return { ok: false, status: 403 }

  const assignedSlugs = await getAssignedEventSlugs(userId)
  if (eventSlug && !assignedSlugs.includes(eventSlug)) {
    return { ok: false, status: 403 }
  }
  return { ok: true, userId, isAdmin: false, assignedSlugs }
}
