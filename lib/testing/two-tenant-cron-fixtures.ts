// Per-tenant cron fixtures for the two-tenant kit (S5 B26). For each cron that
// runs per tenant (lib/cron-scope.ts, scope per_tenant), the rows it reads, one
// set for Stellr and one for the canary tenant, hung off the kit's events.
// test/integration/two-tenant/crons.int.test.ts runs each cron against them.
//
// planCronFixtures is pure, and lib/testing/two-tenant-cron-fixtures.test.ts
// checks it; writeCronFixtures and removeCronFixtures do the I/O, on the kit's
// owner connection, in CI's tenant-db job only. Nothing here is personal data:
// fixed test ids, example.test addresses, and the matrix's iso events.
//
// No row names a tenant_id: the derivation triggers stamp it from the event, as
// they do in the app. writeCronFixtures reads the stamp back and fails a row
// that landed with the wrong tenant, so a fixture cannot pass for the wrong one.

import type postgres from 'postgres'

/** The per-tenant crons (lib/cron-scope.ts, scope per_tenant). test/integration/two-tenant/crons.int.test.ts runs each. */
export const PER_TENANT_CRONS = [
  'surveys',
  'team-profiles',
  'survey-retention',
  'event-emails',
  'docusign-reminders',
  'group-invoice-sync',
] as const
export type PerTenantCron = (typeof PER_TENANT_CRONS)[number]

export type FixtureTag = 'stellr' | 'canary'

/** The shape of a kit tenant this needs (test/integration/two-tenant/kit.ts KitTenant). */
export interface FixtureTenant {
  id: string
  /** Upcoming: the event the live rows hang off. */
  event: { slug: string }
  /** The second event: holds the rows that must be skipped or are long past. */
  spare: { slug: string }
}

export interface FixtureRow {
  table: string
  tag: FixtureTag | null
  /** The crons that read this row. */
  crons: PerTenantCron[]
  values: Record<string, string | number | boolean | null>
}

/** The survey definition the fixture distributions use. Shared, not a tenant table. */
export const CRON_FIXTURE_DEFINITION = 'c1000000-0000-4000-8000-0000000000d1'

const PREFIX: Record<FixtureTag, string> = { stellr: 'a1', canary: 'b1' }

/** A fixed id for one fixture row of one tenant. */
export function cronFixtureId(tag: FixtureTag, n: number): string {
  return `${PREFIX[tag]}000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** The ids each tenant's rows carry, by name. */
export function cronFixtureIds(tag: FixtureTag) {
  return {
    registration: cronFixtureId(tag, 1),
    participant: cronFixtureId(tag, 2),
    emailDue: cronFixtureId(tag, 3),
    emailStale: cronFixtureId(tag, 4),
    agreement: cronFixtureId(tag, 5),
    distributionOpen: cronFixtureId(tag, 6),
    distributionOld: cronFixtureId(tag, 7),
    invitationOld: cronFixtureId(tag, 8),
  }
}

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString()

/**
 * Every fixture row, parents first. `now` sets the relative times: an invoice
 * sync due an hour ago, an envelope sent a month ago, an open survey.
 */
export function planCronFixtures(tenants: Record<FixtureTag, FixtureTenant>, now: Date): FixtureRow[] {
  const t = now.getTime()
  const rows: FixtureRow[] = [
    {
      table: 'survey_definitions',
      tag: null,
      crons: ['surveys', 'survey-retention'],
      values: {
        id: CRON_FIXTURE_DEFINITION,
        key: 'cron_fixture_survey',
        version: 1,
        title: 'Cron fixture survey',
        definition: '{}',
        definition_sha256: '0'.repeat(64),
      },
    },
  ]
  for (const tag of ['stellr', 'canary'] as const) {
    const ten = tenants[tag]
    const ids = cronFixtureIds(tag)
    rows.push(
      {
        table: 'registrations',
        tag,
        crons: ['group-invoice-sync', 'team-profiles', 'survey-retention'],
        values: {
          id: ids.registration,
          event_slug: ten.event.slug,
          event_title: 'Cron fixture',
          type: 'individual',
          // group-invoice-sync: an unpaid group invoice update that is due.
          invoice_sync_due_at: iso(t - 60 * 60 * 1000),
        },
      },
      {
        table: 'participants',
        tag,
        crons: ['team-profiles', 'survey-retention'],
        values: {
          id: ids.participant,
          registration_id: ids.registration,
          first_name: 'Cron',
          last_name: 'Fixture',
          email: `cron-fixture-${tag}@example.test`,
          phone: '0',
          // An adult with no envelope: their forms count as complete (team-profiles).
          date_of_birth: '2000-01-01',
          gender: '',
          t_shirt_size: 'M',
          school_name: '',
          age_bracket: 'high_school',
          event_role: 'participant',
        },
      },
      {
        table: 'event_emails',
        tag,
        crons: ['event-emails'],
        // Due on the upcoming event.
        values: { id: ids.emailDue, event_slug: ten.event.slug, name: 'cron fixture due', status: 'scheduled', schedule_days_before: 7 },
      },
      {
        table: 'event_emails',
        tag,
        crons: ['event-emails'],
        // On the spare event, which the test's event lookup puts in the past: skipped, a real write.
        values: { id: ids.emailStale, event_slug: ten.spare.slug, name: 'cron fixture stale', status: 'scheduled', schedule_days_before: 3 },
      },
      {
        table: 'agreements',
        tag,
        crons: ['docusign-reminders'],
        values: {
          id: ids.agreement,
          event_slug: ten.event.slug,
          event_title: 'Cron fixture',
          envelope_id: `cron-fixture-env-${tag}`,
          signer_name: 'Fixture Signer',
          signer_email: 'signer@example.test',
          minor_name: 'Fixture Minor',
          // Stellr signing, sent a month ago and never chased: due a reminder.
          provider: 'native',
          status: 'sent',
          sent_at: iso(t - 30 * DAY),
          reminder_count: 0,
        },
      },
      {
        table: 'survey_distributions',
        tag,
        crons: ['surveys'],
        values: {
          id: ids.distributionOpen,
          definition_id: CRON_FIXTURE_DEFINITION,
          event_slug: ten.event.slug,
          event_date: iso(t - 2 * DAY).slice(0, 10),
          event_time_zone: 'UTC',
          opens_at: iso(t - DAY),
          closes_at: iso(t + 29 * DAY),
          status: 'open',
        },
      },
      {
        table: 'survey_distributions',
        tag,
        crons: ['survey-retention'],
        // Long past: its invitation's 7 years ran out in 2023.
        values: {
          id: ids.distributionOld,
          definition_id: CRON_FIXTURE_DEFINITION,
          event_slug: ten.spare.slug,
          event_date: '2015-06-01',
          event_time_zone: 'UTC',
          opens_at: '2015-06-01T00:00:00.000Z',
          closes_at: '2015-07-01T00:00:00.000Z',
          status: 'closed',
        },
      },
      {
        table: 'survey_invitations',
        tag,
        crons: ['survey-retention'],
        values: {
          id: ids.invitationOld,
          distribution_id: ids.distributionOld,
          participant_id: ids.participant,
          recipient_key: `participant:${ids.participant}`,
          respondent_role: 'student',
          email: `cron-fixture-${tag}@example.test`,
          token_hash: `cron-fixture-invite-${tag}`,
        },
      },
    )
  }
  return rows
}

/** The tables the crons themselves write rows into, cleared by removeCronFixtures. */
const CRON_WRITTEN = ['team_profiles'] as const

/**
 * Writes the plan, parents first, on the kit's owner connection. Each tenant row
 * must come back stamped with its own tenant; anything else throws.
 */
export async function writeCronFixtures(sql: postgres.Sql, plan: readonly FixtureRow[], tenants: Record<FixtureTag, FixtureTenant>): Promise<void> {
  for (const row of plan) {
    const cols = Object.keys(row.values)
    const conflict = row.tag === null ? ' ON CONFLICT DO NOTHING' : ''
    const returning = row.tag === null ? '' : ' RETURNING tenant_id::text AS tenant_id'
    // Fixed identifiers from this file; every value goes as a parameter.
    const text =
      `INSERT INTO public.${row.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})${conflict}${returning}`
    let out: { tenant_id?: string }[]
    try {
      out = await sql.unsafe(text, cols.map((c) => (row.values[c] === null ? null : String(row.values[c]))) as never[])
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown'
      throw new Error(`cron fixture ${row.table} for ${row.tag ?? 'shared'} failed (${code}): ${(err as Error).message}`)
    }
    if (row.tag && out[0]?.tenant_id !== tenants[row.tag].id) {
      throw new Error(`cron fixture ${row.table}: the ${row.tag} row was stamped ${out[0]?.tenant_id ?? 'with nothing'}`)
    }
  }
}

/** Deletes the plan's rows, what the crons wrote off them, and the crons' cron_runs rows. Never throws. */
export async function removeCronFixtures(sql: postgres.Sql, plan: readonly FixtureRow[]): Promise<void> {
  const participants = plan.filter((r) => r.table === 'participants').map((r) => String(r.values.id))
  for (const table of CRON_WRITTEN) {
    await sql
      .unsafe(`DELETE FROM public.${table} WHERE participant_id::text IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(participants)] as never[])
      .catch(() => {})
  }
  // Children before parents: parent_id cascades, and tenant_id would otherwise hold the canary tenant.
  await sql`DELETE FROM public.cron_runs WHERE job = ANY(${[...PER_TENANT_CRONS]}::text[]) AND parent_id IS NOT NULL`.catch(() => {})
  await sql`DELETE FROM public.cron_runs WHERE job = ANY(${[...PER_TENANT_CRONS]}::text[])`.catch(() => {})
  for (const row of [...plan].reverse()) {
    await sql.unsafe(`DELETE FROM public.${row.table} WHERE id = $1::uuid`, [String(row.values.id)] as never[]).catch(() => {})
  }
}
