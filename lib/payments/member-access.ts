import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { impersonatedMemberId } from '@/lib/impersonation'
import { tokens } from '@/lib/tokens'
import {
  PARTICIPANT_DOC_COLUMNS,
  REGISTRATION_DOC_COLUMNS,
  type ParticipantForDocs,
  type RegistrationForDocs,
} from './documents'

// The signed-in member's own place, for the Billing tab's Receipt and Invoice links.
// Honours an admin view-as session (read only), as the receipt link always has. A
// place that is not the member's answers as missing.

/** A small HTML page for a plain link that cannot be followed. */
export function htmlMessage(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem;color:${tokens.color.text.body}">${message}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export type MemberPlace =
  | { ok: true; db: SupabaseClient; memberId: string; participant: ParticipantForDocs; registration: RegistrationForDocs }
  | { ok: false; response: NextResponse }

/** userId: the route's own auth() answer (the route manifest checks each route calls it). */
export async function loadMemberPlace(userId: string | null, participationId: string | null): Promise<MemberPlace> {
  if (!userId) return { ok: false, response: htmlMessage('Please sign in to see your payment documents.', 401) }
  if (!participationId) return { ok: false, response: htmlMessage('Missing participation reference.', 400) }

  const db = supabaseServer()
  const viewAsId = await impersonatedMemberId()
  const { data: member } = viewAsId
    ? await db.from('members').select('id').eq('id', viewAsId).maybeSingle()
    : await db.from('members').select('id').eq('clerk_user_id', userId).eq('is_active', true).maybeSingle()
  if (!member) return { ok: false, response: htmlMessage('Member record not found.', 404) }

  const { data: participant } = await db
    .from('participants')
    .select(PARTICIPANT_DOC_COLUMNS)
    .eq('id', participationId)
    .eq('member_id', member.id)
    .maybeSingle()
  if (!participant) return { ok: false, response: htmlMessage('Participation not found.', 404) }

  const { data: registration } = await db
    .from('registrations')
    .select(REGISTRATION_DOC_COLUMNS)
    .eq('id', (participant as ParticipantForDocs).registration_id)
    .maybeSingle()
  if (!registration) return { ok: false, response: htmlMessage('Registration not found.', 404) }

  return {
    ok: true,
    db,
    memberId: member.id as string,
    participant: participant as ParticipantForDocs,
    registration: registration as unknown as RegistrationForDocs,
  }
}
