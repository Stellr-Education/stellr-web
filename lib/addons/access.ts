// Event add-ons: who is booking, from the member's side (Phase 2).
//
// An organiser (the registrant, teacher or student manager, or the Teacher POC:
// lib/team-access.ts) books for their group. Anyone else on the registration
// books only for themselves (merch only, in a group: Q15). Nobody else gets in.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ownsTeam, teamViewerRole } from '@/lib/team-access'
import type { BookingActor } from './plan'
import type { BookingRegistration } from './booking'

export interface MemberLite {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
}

export async function memberForClerkUser(db: SupabaseClient, clerkUserId: string): Promise<MemberLite | null> {
  const { data } = await db
    .from('members')
    .select('id, email, first_name, last_name')
    .eq('clerk_user_id', clerkUserId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as MemberLite | null) ?? null
}

export async function actorFor(db: SupabaseClient, member: MemberLite, registration: BookingRegistration): Promise<BookingActor | null> {
  if (registration.type === 'group' && ownsTeam(member, registration)) {
    const role = teamViewerRole(member, registration) ?? 'teacher'
    return { kind: 'organiser', role }
  }
  const { data } = await db
    .from('participants')
    .select('id')
    .eq('registration_id', registration.id)
    .eq('member_id', member.id)
    .maybeSingle()
  const pid = (data as { id: string } | null)?.id
  return pid ? { kind: 'member', participantId: pid } : null
}
