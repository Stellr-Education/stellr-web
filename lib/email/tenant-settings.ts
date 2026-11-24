// A tenant's email settings (tenant_email_settings, email plan D): reading
// them, and checking what the super-admin console may write. The sender built
// from them is lib/event-emails/tenant-mail.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface TenantEmailSettings {
  tenant_id: string
  sending_domain: string | null
  resend_domain_id: string | null
  domain_status: string
  forge_status: string
  domain_checked_at: string | null
  from_local_part: string
  from_name: string | null
  reply_to: string | null
  marketing_daily_cap: number | null
  marketing_monthly_cap: number | null
  marketing_paused_at: string | null
  paused_reason: string | null
  updated_at: string
  updated_by: string | null
}

export async function loadTenantEmailSettings(db: SupabaseClient, tenantId: string): Promise<TenantEmailSettings | null> {
  const { data, error } = await db.from('tenant_email_settings').select('*').eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new Error(`tenant email settings read failed: ${error.message}`)
  return (data as TenantEmailSettings | null) ?? null
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const LOCAL_RE = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/
const EMAIL_RE = /^[^\s@<>",;:()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

/** Stellr's own domains: never a tenant's, or a tenant could send as Stellr. */
const PLATFORM_DOMAIN_SUFFIXES = ['stellreducation.org']

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * A sending domain as typed into the console: trimmed, lower-cased, no scheme,
 * and a real host name that is not one of Stellr's. A subdomain (mail.example.org)
 * is recommended so the tenant's own mailboxes keep their reputation apart.
 */
export function checkSendingDomain(raw: unknown): Checked<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a domain, like mail.example.org.' }
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
  if (d.length > 253 || !DOMAIN_RE.test(d)) return { ok: false, error: 'That isn’t a domain name. Use one like mail.example.org.' }
  if (PLATFORM_DOMAIN_SUFFIXES.some((s) => d === s || d.endsWith(`.${s}`))) {
    return { ok: false, error: 'A tenant can’t send from a Stellr domain.' }
  }
  return { ok: true, value: d }
}

export interface SenderFields {
  from_name?: string | null
  from_local_part?: string
  reply_to?: string | null
}

/** The sender fields the console may change; any other key is ignored. */
export function checkSenderFields(b: Record<string, unknown>): Checked<SenderFields> {
  const out: SenderFields = {}
  if ('from_name' in b) {
    if (b.from_name === null || b.from_name === '') out.from_name = null
    else if (typeof b.from_name === 'string') {
      const name = b.from_name.replace(/[\u0000-\u001f\u007f"<>\\]/g, ' ').replace(/\s+/g, ' ').trim()
      if (!name || name.length > 64) return { ok: false, error: 'The sender name must be 1 to 64 characters.' }
      out.from_name = name
    } else return { ok: false, error: 'The sender name must be text.' }
  }
  if ('from_local_part' in b) {
    const local = typeof b.from_local_part === 'string' ? b.from_local_part.trim().toLowerCase() : ''
    if (!LOCAL_RE.test(local)) return { ok: false, error: 'The address before the @ may use letters, numbers, dots, dashes and underscores.' }
    out.from_local_part = local
  }
  if ('reply_to' in b) {
    if (b.reply_to === null || b.reply_to === '') out.reply_to = null
    else if (typeof b.reply_to === 'string' && b.reply_to.trim().length <= 254 && EMAIL_RE.test(b.reply_to.trim())) out.reply_to = b.reply_to.trim()
    else return { ok: false, error: 'Replies need a valid email address.' }
  }
  return { ok: true, value: out }
}

/** Domains the plan allows (Resend Pro: 10), and how many Stellr itself uses (mail. and community.). */
export function domainLimit(): { limit: number; platform: number } {
  const n = Number(process.env.RESEND_DOMAIN_LIMIT)
  return { limit: Number.isInteger(n) && n > 0 ? n : 10, platform: 2 }
}
