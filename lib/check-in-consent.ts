// Check-in and a tenant event's guardian consent (S5 wave 6).
//
// A 14-17-year-old registered for another organiser's event is consent-pending
// until a parent or guardian signs (lib/registration/tenant-guardian-consent.ts).
// The database refuses to check them in: the trigger
// zzz_participants_refuse_unconsented_check_in raises 23514 with the message
// 'guardian_consent_pending' on any write that sets checked_in_at. This tells that
// refusal from any other failed write, so a route can say why.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Shown to the participant at the door. A proposal for the owner. */
export const GUARDIAN_CONSENT_PENDING_CHECK_IN =
  "You can't check in yet: your parent or guardian hasn't signed the consent form. Please see the registration desk."

/** Shown to staff at the desk. A proposal for the owner. */
export const GUARDIAN_CONSENT_PENDING_DESK =
  "Not checked in: a parent or guardian hasn't signed the consent form for this participant yet. In a group, check the others in one at a time."

/** The trigger's refusal, as PostgREST reports it. */
export function isConsentPendingRefusal(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!error && error.code === '23514' && (error.message ?? '').includes('guardian_consent_pending')
}

// ── The desk (S5 CONSENT (c), wave 8 slice 8; defaults WD-6, BF-66) ───────────
//
// The desk asks before it writes: a participant whose consent is not signed is a
// failed scan, answered with the same refusal the trigger's would get, and nothing
// is written. The trigger stays the backstop for a read that fails or a consent
// that lands between the read and the write. The desk list and the group sheet
// mark such a participant with CONSENT_PENDING_MARKER.
//
// "Not signed" is the trigger's own test (status <> 'signed'): a declined or
// expired row is refused too, until the sweep removes its registration. Only a
// tenant event has consent rows (tenant_guardian_consents_not_stellr), so for a
// Stellr event every read below comes back empty and the desk is unchanged.

/** The desk's marker for a participant waiting on consent (WD-6). A proposal for the owner. */
export const CONSENT_PENDING_MARKER = 'Waiting for guardian consent'

/** The refusal code every desk path and the door answer with. */
export const CONSENT_PENDING_CODE = 'guardian_consent_pending'

/** What the desk's poll adds to a participant waiting on consent. Absent otherwise. */
export interface DeskConsentMarker {
  consentPending?: true
}

/**
 * The participants, among those named, whose guardian consent is not signed. By
 * participant id (a desk write) or by registration id (the desk's poll). Null when
 * the read failed: the caller carries on and the trigger decides. Never throws.
 */
export async function consentPendingParticipants(
  db: SupabaseClient,
  by: { participantIds: string[] } | { registrationIds: string[] }
): Promise<Set<string> | null> {
  const [column, ids] =
    'participantIds' in by ? (['participant_id', by.participantIds] as const) : (['registration_id', by.registrationIds] as const)
  if (ids.length === 0) return new Set()
  try {
    const { data, error } = await db.from('tenant_guardian_consents').select('participant_id').in(column, ids).neq('status', 'signed')
    if (error || !Array.isArray(data)) return null
    return new Set(
      (data as { participant_id?: unknown }[]).map((r) => r.participant_id).filter((id): id is string => typeof id === 'string')
    )
  } catch {
    return null
  }
}

/** True for a desk row the poll marked as waiting on guardian consent. */
export function isConsentPending(p: object): boolean {
  return (p as DeskConsentMarker).consentPending === true
}
