// Resend's domains API, for a tenant's own sending domain (email plan D2).
//
// Only the calls the super-admin console needs: add a domain, read its DNS
// records and status, ask Resend to check them, and remove it. Raw fetch, like
// lib/email/transport.ts. Tracking stays off: a tenant domain carries
// transactional event mail only (PLAN-multi-tenant: no community features).
// Forge is turned on from Resend for now; its API is not wrapped here.

const API = 'https://api.resend.com'

export interface ResendDnsRecord {
  record: string
  name: string
  type: string
  value: string
  status: string
  priority?: number
  ttl?: string
}

export interface ResendDomain {
  id: string
  name: string
  status: string
  records: ResendDnsRecord[]
}

/** Resend refused the call. `status` is its HTTP status. */
export class ResendDomainError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ResendDomainError'
    this.status = status
  }
}

/** Domain statuses Resend reports; tenant_email_settings.domain_status allows the same set plus 'none'. */
export const RESEND_DOMAIN_STATUSES = ['not_started', 'pending', 'verified', 'failed', 'temporary_failure'] as const

export function domainStatusOf(raw: unknown): (typeof RESEND_DOMAIN_STATUSES)[number] {
  return (RESEND_DOMAIN_STATUSES as readonly string[]).includes(raw as string) ? (raw as (typeof RESEND_DOMAIN_STATUSES)[number]) : 'pending'
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new ResendDomainError('RESEND_API_KEY is not set', 503)
  return key
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch { /* keep the raw body */ }
    throw new ResendDomainError(message.slice(0, 300) || `Resend answered ${res.status}`, res.status)
  }
  return (text ? JSON.parse(text) : {}) as T
}

function toDomain(raw: Partial<ResendDomain> & { id?: string }): ResendDomain {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: domainStatusOf(raw.status),
    records: Array.isArray(raw.records) ? raw.records : [],
  }
}

/** Add a domain to the account (us-east-1, the region every Stellr domain uses). */
export async function createDomain(name: string): Promise<ResendDomain> {
  return toDomain(await call('POST', '/domains', { name, region: 'us-east-1' }))
}

export async function getDomain(id: string): Promise<ResendDomain> {
  return toDomain(await call('GET', `/domains/${encodeURIComponent(id)}`))
}

/** Ask Resend to check the DNS records now. The answer comes back on the next getDomain. */
export async function verifyDomain(id: string): Promise<void> {
  await call('POST', `/domains/${encodeURIComponent(id)}/verify`)
}

export async function removeDomain(id: string): Promise<void> {
  await call('DELETE', `/domains/${encodeURIComponent(id)}`)
}
