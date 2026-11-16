// Helpers the audited admin routes share (docs/TENANCY-S5.md, C7). They sit outside
// lib/audit so the audit library's own files stay with the slice that owns them.
import type { AuditMutation } from '@/lib/audit/route'
import { auditSubject } from '@/lib/audit/route-subject'

/** The member in the URL, /api/admin/members/<id>/…: the event's target. */
export function memberIdOf(req: Request): string | null {
  const parts = new URL(req.url).pathname.split('/')
  const at = parts.indexOf('members')
  return at < 0 ? null : (parts[at + 1] ?? null)
}

/**
 * The actor, chain, target and metadata of an event-route audit event. The chain is the
 * owner of the event the handler's access check verified (the slug it noted with
 * noteAuditSubject), never the raw slug in the URL: the table is append-only, so a row
 * put on the wrong tenant's chain stays there. A request that stopped before the check
 * noted no slug and goes on the platform chain, as route-subject.ts says.
 */
export function verifiedEventAudit(req: Request, table: string): Omit<AuditMutation, 'action'> {
  const subject = auditSubject(req, table)
  const slug = subject.metadata?.event_slug
  return { ...subject, tenant: typeof slug === 'string' && slug ? { eventSlug: slug } : { tenantId: null } }
}
