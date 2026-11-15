// stellr_staff outcomes that would otherwise fail a staff case, each with its reviewed reason.
//
// Keyed `<route file> <METHOD>`. An entry may only name a platform route (platform_admin or
// platform_destined) that checks a capability Staff holds (staffCapabilitiesIn): there the
// owner gave Staff the capability, so reaching the record is the capability working, not a
// leak. It can never cover an admin-only route, a tenant_crew route (Staff naming another
// tenant's record there is a real leak), another persona, or an outcome other than the one
// written: test/idor/staff-persona.test.ts holds those rules, and crewCaseProblem in
// test/idor/harness.ts reads the entry.
//
// A reason is reviewed before it is committed. 'TODO: review' fails, as in the snapshot.
import type { Outcome } from './harness'

export interface StaffAccepted {
  outcome: Outcome
  reason: string
}

export const STAFF_ACCEPTED: Record<string, StaffAccepted> = {
  'app/api/admin/schools/[id]/route.ts PATCH': {
    outcome: 'leak',
    reason:
      'public.schools is the platform school directory (lib/tenancy/registry.ts): a school row has no tenant, so the honey school is a shared row, not another tenant’s record. Editing it, and getting the edited row back (the leak and the write here), is schools:write, which Staff holds by the owner’s 13 Nov decision (lib/authz/capabilities.ts). The participant and the Canary admin are refused at the guard.',
  },
}
