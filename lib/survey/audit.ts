/**
 * audit_log and survey_access_log writers.
 *
 * audit_log's action enum is INSERT | UPDATE | DELETE and record_id a uuid,
 * so survey events are recorded as the closest operation on a named pseudo
 * table (survey_distributions, survey_quote_withdrawal, survey_testimonial_export)
 * with the detail in new_data. Never put answers in either log: a deletion
 * request must leave nothing of them behind.
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

export async function writeAudit(
  db: SupabaseClient,
  entry: { table: string; recordId?: string | null; action: 'INSERT' | 'UPDATE' | 'DELETE'; actor: string; data: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('audit_log').insert({
    table_name: entry.table,
    record_id: entry.recordId ?? randomUUID(),
    action: entry.action,
    changed_by: entry.actor,
    new_data: entry.data,
  })
  if (error) console.error('[survey] audit_log write failed:', error.message)
}

export async function logSurveyAccess(
  db: SupabaseClient,
  entry: {
    actor: string
    action: 'view' | 'export' | 'testimonial_export'
    eventSlug?: string | null
    distributionId?: string | null
    responseId?: string | null
    rowCount?: number | null
    detail?: Record<string, unknown>
    /** The tenant whose surveys were read, when the caller resolved one (an event route's crew). */
    tenantId?: string
  },
): Promise<void> {
  // S5 wave 8: explicit where it is known. Without one, an event's row is left to the trigger
  // (it derives the event's tenant), and a row with no event is Stellr's: the survey admin
  // pages and the export are Stellr's.
  const tenantId = entry.tenantId ?? (entry.eventSlug ? null : STELLR_TENANT_ID)
  const { error } = await db.from('survey_access_log').insert({
    tenant_id: tenantId,
    actor: entry.actor,
    action: entry.action,
    event_slug: entry.eventSlug ?? null,
    distribution_id: entry.distributionId ?? null,
    response_id: entry.responseId ?? null,
    row_count: entry.rowCount ?? null,
    detail: entry.detail ?? null,
  })
  if (error) console.error('[survey] survey_access_log write failed:', error.message)
}
