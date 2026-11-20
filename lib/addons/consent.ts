// Event add-ons: the overnight and off-site addendum hook (FR-5b, Q10, Q11).
//
// A minor's accommodation or tour line waits, once paid, for the addendum to the
// participant and parent agreement. The addendum is written in December 2026,
// outside this work. Until its template exists nothing reads as signed, so a
// minor's line can be booked and paid but stays "Awaiting overnight consent", and
// sales to minors must not open before the addendum is live.
//
// When the addendum ships: set ADDON_ADDENDUM_TEMPLATE to its template id, and
// make this read that template's signed agreements for the participants given.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The participants (of those given) whose addendum is signed. Empty until the addendum exists. */
export async function addendumSignedFor(_db: SupabaseClient, _participantIds: string[]): Promise<Set<string>> {
  if (!process.env.ADDON_ADDENDUM_TEMPLATE) return new Set()
  // Wired when the December addendum's template exists (see the header).
  return new Set()
}

/** A line's status once it is paid (or needs no payment). */
export function settledStatus(needsAddendum: boolean, signed: boolean): 'confirmed' | 'pending_consent' {
  return needsAddendum && !signed ? 'pending_consent' : 'confirmed'
}
