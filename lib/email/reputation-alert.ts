// The daily reputation check (email plan E): find tenants whose mail is drawing
// complaints or hard bounces above the alert lines, and tell staff once a week per
// tenant. Called by app/api/cron/email-reputation.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, teamInboxEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/email-layout'
import { appUrl } from '@/lib/email/unsubscribe-url'
import { pct, REPUTATION_WINDOW_DAYS, tenantReputations, type TenantReputation } from './reputation'

/** Re-alert about the same tenant only after this long. */
export const REALERT_DAYS = 7

export interface ReputationCheck {
  checked: number
  concerning: number
  alerted: string[]
}

export async function checkTenantReputation(db: SupabaseClient, now = new Date()): Promise<ReputationCheck> {
  const reps = await tenantReputations(db, now)
  const concerning = reps.filter((r) => r.concerns.length)
  if (!concerning.length) return { checked: reps.length, concerning: 0, alerted: [] }

  const ids = concerning.map((r) => r.tenantId)
  const [{ data: settings, error: sErr }, { data: tenants, error: tErr }] = await Promise.all([
    db.from('tenant_email_settings').select('tenant_id, reputation_alerted_at').in('tenant_id', ids),
    db.from('tenants').select('id, display_name').in('id', ids),
  ])
  if (sErr) throw new Error(`settings read failed: ${sErr.message}`)
  if (tErr) throw new Error(`tenants read failed: ${tErr.message}`)
  const lastAlert = new Map(((settings ?? []) as { tenant_id: string; reputation_alerted_at: string | null }[]).map((s) => [s.tenant_id, s.reputation_alerted_at]))
  const names = new Map(((tenants ?? []) as { id: string; display_name: string | null }[]).map((t) => [t.id, t.display_name ?? t.id]))

  const cutoff = now.getTime() - REALERT_DAYS * 86_400_000
  const due = concerning.filter((r) => {
    const last = lastAlert.get(r.tenantId)
    return !last || new Date(last).getTime() < cutoff
  })
  if (!due.length) return { checked: reps.length, concerning: concerning.length, alerted: [] }

  const line = (r: TenantReputation) =>
    `${names.get(r.tenantId)}: ${r.complaints} complaint(s) (${pct(r.complaintRate)}), ${r.hardBounces} hard bounce(s) (${pct(r.hardBounceRate)}) out of ${r.reached} reached`
  const link = (r: TenantReputation) => `${appUrl()}/admin/platform/tenants/${r.tenantId}`
  const text = [
    `These organisations' email drew more complaints or hard bounces than is safe over the last ${REPUTATION_WINDOW_DAYS} days.`,
    'Nothing has been paused. If it keeps up, the Resend account that sends everyone\'s mail is at risk.',
    'Open each one in the console to see its sends, set a cap or pause its event blasts:',
    '',
    ...due.flatMap((r) => [line(r), link(r), '']),
  ].join('\n')
  const html = `<p>These organisations’ email drew more complaints or hard bounces than is safe over the last ${REPUTATION_WINDOW_DAYS} days.</p>
<p>Nothing has been paused. If it keeps up, the Resend account that sends everyone’s mail is at risk. Open each one in the console to see its sends, set a cap or pause its event blasts:</p>
<ul>${due.map((r) => `<li>${escapeHtml(line(r))} — <a href="${escapeHtml(link(r))}">open in the console</a></li>`).join('')}</ul>`

  await sendEmail({
    to: teamInboxEmail(),
    subject: `Email reputation: ${due.length} organisation${due.length === 1 ? '' : 's'} need${due.length === 1 ? 's' : ''} a look`,
    html,
    text,
    critical: true,
    tags: { feature: 'reputation_alert' },
  })

  const stamp = now.toISOString()
  const { error: upErr } = await db
    .from('tenant_email_settings')
    .upsert(due.map((r) => ({ tenant_id: r.tenantId, reputation_alerted_at: stamp, updated_at: stamp, updated_by: 'cron:email-reputation' })), { onConflict: 'tenant_id' })
  if (upErr) console.error('[email-reputation] could not record the alert time:', upErr.message)
  return { checked: reps.length, concerning: concerning.length, alerted: due.map((r) => r.tenantId) }
}
