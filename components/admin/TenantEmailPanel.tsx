import type { SupabaseClient } from '@supabase/supabase-js'
import { getDomain, type ResendDnsRecord } from '@/lib/email/resend-domains'
import { loadTenantEmailSettings, type TenantEmailSettings } from '@/lib/email/tenant-settings'
import { tenantEventSender } from '@/lib/event-emails/tenant-mail'
import { TenantEmailForm } from '@/components/admin/TenantEmailForm'
import { pct, REPUTATION_WINDOW_DAYS, tenantReputations, type TenantReputation } from '@/lib/email/reputation'

const STATUS_LABEL: Record<string, string> = {
  none: 'No own domain',
  not_started: 'Waiting for DNS records',
  pending: 'Checking DNS records',
  verified: 'Verified: mail sends from this domain',
  failed: 'DNS check failed',
  temporary_failure: 'DNS check failed for now; Resend will retry',
}

/**
 * Email plan D2: a tenant's sender and own sending domain, for the super-admin
 * console. Rendered only on a page that has already checked assertPlatformAdmin;
 * every change goes through the email API, which checks again. The platform owner
 * has none: Stellr's domains are managed in Resend directly.
 */
export async function TenantEmailPanel({
  db,
  tenantId,
  displayName,
  isPlatformOwner,
}: {
  db: SupabaseClient
  tenantId: string
  displayName: string | null
  isPlatformOwner: boolean
}) {
  if (isPlatformOwner) return null
  let settings: TenantEmailSettings | null = null
  let branding: unknown = null
  let readFailed = false
  try {
    settings = await loadTenantEmailSettings(db, tenantId)
    // Only the older branding.reply_to fallback is read; nothing else from branding is shown.
    const { data, error } = await db.from('tenants').select('branding').eq('id', tenantId).maybeSingle()
    if (error) throw new Error(error.message)
    branding = (data as { branding?: unknown } | null)?.branding ?? null
  } catch {
    readFailed = true
  }
  let records: ResendDnsRecord[] = []
  let recordsFailed = false
  if (settings?.resend_domain_id) {
    try {
      records = (await getDomain(settings.resend_domain_id)).records
    } catch {
      recordsFailed = true
    }
  }
  let reputation: TenantReputation | null = null
  try {
    reputation = (await tenantReputations(db)).find((r) => r.tenantId === tenantId) ?? null
  } catch {
    /* the rates are informative only; the rest of the panel still shows */
  }
  const sender = tenantEventSender({ display_name: displayName, branding, tenant_email_settings: settings })
  const status = settings?.domain_status ?? 'none'

  return (
    <section aria-labelledby="email-heading" className="rounded-ds-card border border-line bg-white p-5">
      <h2 id="email-heading" className="font-heading text-ds-h3 text-ink">
        Email
      </h2>
      {readFailed ? (
        <p role="alert" className="mt-2 text-sm text-danger">Couldn’t read this tenant’s email settings.</p>
      ) : (
        <>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <dt className="text-content-muted">Event mail is from</dt>
            <dd className="sm:col-span-2 break-all text-ink">{sender ? sender.from : 'Nobody yet: add a reply-to address, or their mail is held'}</dd>
            <dt className="text-content-muted">Replies go to</dt>
            <dd className="sm:col-span-2 break-all text-ink">{sender?.replyTo ?? '—'}</dd>
            <dt className="text-content-muted">Own domain</dt>
            <dd className="sm:col-span-2 text-ink">
              {settings?.sending_domain ? `${settings.sending_domain} · ` : ''}
              <span className={status === 'verified' ? 'text-enviro-green-text' : status === 'failed' ? 'text-danger' : ''}>
                {STATUS_LABEL[status] ?? status}
              </span>
            </dd>
            <dt className="text-content-muted">Last {REPUTATION_WINDOW_DAYS} days</dt>
            <dd className="sm:col-span-2 text-ink">
              {reputation && reputation.reached > 0 ? (
                <span className={reputation.concerns.length ? 'text-danger' : ''}>
                  {reputation.reached} reached · {reputation.complaints} complaint{reputation.complaints === 1 ? '' : 's'} ({pct(reputation.complaintRate)}) ·{' '}
                  {reputation.hardBounces} hard bounce{reputation.hardBounces === 1 ? '' : 's'} ({pct(reputation.hardBounceRate)})
                  {reputation.concerns.length ? ' · above the alert line' : ''}
                </span>
              ) : (
                'No mail delivered yet'
              )}
            </dd>
            <dt className="text-content-muted">Event blasts</dt>
            <dd className="sm:col-span-2 text-ink">
              {settings?.bulk_paused_at ? (
                <span className="text-danger">Paused{settings.paused_reason ? `: ${settings.paused_reason}` : ''}</span>
              ) : (
                <>
                  {settings?.bulk_daily_cap != null ? `${settings.bulk_daily_cap} a day` : 'No daily cap'} ·{' '}
                  {settings?.bulk_monthly_cap != null ? `${settings.bulk_monthly_cap} a month` : 'no monthly cap'}
                </>
              )}
            </dd>
          </dl>

          {settings?.sending_domain && status !== 'verified' && (
            <div className="mt-4">
              <p className="text-sm text-content-body">
                Send these DNS records to the tenant. Their mail keeps going out as “{displayName} via Stellr” until every record checks out.
              </p>
              {recordsFailed ? (
                <p role="alert" className="mt-2 text-sm text-danger">Couldn’t load the records from Resend. Try again in a minute.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-content-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Type</th>
                        <th className="py-1 pr-3 font-medium">Name</th>
                        <th className="py-1 pr-3 font-medium">Value</th>
                        <th className="py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="align-top text-ink">
                      {records.map((r) => (
                        <tr key={`${r.type}-${r.name}-${r.value}`} className="border-t border-line-light">
                          <td className="py-1 pr-3">{r.type}{r.priority != null ? ` (${r.priority})` : ''}</td>
                          <td className="break-all py-1 pr-3 font-mono">{r.name}</td>
                          <td className="break-all py-1 pr-3 font-mono">{r.value}</td>
                          <td className="py-1">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <TenantEmailForm
            tenantId={tenantId}
            hasDomain={Boolean(settings?.sending_domain)}
            fromName={settings?.from_name ?? ''}
            fromLocalPart={settings?.from_local_part ?? 'events'}
            replyTo={settings?.reply_to ?? ''}
            signatureText={settings?.signature_text ?? ''}
            logoUrl={settings?.logo_url ?? ''}
            bulkDailyCap={settings?.bulk_daily_cap ?? null}
            bulkMonthlyCap={settings?.bulk_monthly_cap ?? null}
            bulkPaused={Boolean(settings?.bulk_paused_at)}
          />
        </>
      )}
    </section>
  )
}
