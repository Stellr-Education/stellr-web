// The duty scopes an admin_duties row can hold (migration 044). 'all' = every duty.
//
// This file used to hold the legacy guard helpers (isAdminClaims, currentUserIsAdmin,
// requireAdminPage, currentUserHasScope, hasAdminPortalAccess, isCrewRole,
// CREW_CLERK_ROLES, isEventManagerClaims). S5 C25 batch 4 (21 Nov 2026) deleted them once
// nothing called them; every guard is lib/authz now. The list stays here because the
// Duties page and route read it, and it decides nobody's access: lib/authz hasScope does.
// test/fixtures/authz-legacy.ts keeps the deleted helpers frozen, for the codemod's
// equivalence proof only.

export const DUTY_SCOPES = ['all', 'events', 'memberships', 'community', 'academy', 'graduations'] as const
export type DutyScope = (typeof DUTY_SCOPES)[number]
