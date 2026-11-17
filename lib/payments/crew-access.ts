import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ScopeContext } from '@/lib/tenancy/scope-context'
import { stellrOnlyEvent } from '@/lib/tenancy/load-scoped'
import { rowTenant } from '@/lib/registration/event-context'
import {
  PARTICIPANT_DOC_COLUMNS,
  type ParticipantForDocs,
  type RegistrationForDocs,
} from './documents'

// A place on a registration, for crew downloading its receipt or paid invoice on
// someone's behalf: admins, Staff, and an event's managers for their own events.
// The route asks requireEventCrew who is calling and loads the registration through
// loadEventRecord (another event's answers as missing); this keeps it to the
// caller's tenant and to Stellr's events (the documents are on Stellr's Stripe
// account), and finds the participant on THAT registration.

export interface Crew {
  scope: ScopeContext
  tenantId: string
  covers: (eventSlug: string | null | undefined) => boolean
}

export type CrewPlace =
  | { ok: true; participant: ParticipantForDocs; registration: RegistrationForDocs }
  | { ok: false; response: Response }

export const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * After the route's loadEventRecord: keep the registration to the caller's tenant and to
 * Stellr's events, then find the participant on THAT registration.
 */
export async function placeOnRegistration(
  crew: Crew,
  db: SupabaseClient,
  registration: RegistrationForDocs,
  participantId: string,
  label: string,
): Promise<CrewPlace> {
  if (rowTenant(registration.tenant_id) !== crew.tenantId) return { ok: false, response: notFound() }
  const foreign = await stellrOnlyEvent(crew.scope, db, registration.event_slug, label)
  if (foreign) return { ok: false, response: foreign.status === 404 ? notFound() : foreign }

  const { data: participant } = await db
    .from('participants')
    .select(PARTICIPANT_DOC_COLUMNS)
    .eq('id', participantId)
    .eq('registration_id', registration.id)
    .maybeSingle()
  if (!participant) return { ok: false, response: notFound() }
  return { ok: true, participant: participant as ParticipantForDocs, registration }
}
