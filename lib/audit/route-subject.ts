// What a request acted on, for a withAudit spec (docs/TENANCY-S5.md, C7). The spec runs
// after the handler and sees only its arguments, so the handler notes here who passed the
// check and what they named. Nothing is noted when the handler stops before the check: the
// event then reads the session itself and goes on the platform chain, as resolveTenant's
// rule for a tenant it cannot name says.
import type { AuditMutation } from './route'

export interface AuditSubject {
  userId: string | null
  tenantId: string
  eventSlug?: string
  /**
   * An event slug the route did not verify itself (adminAuditSubject only). The event goes
   * on the chain the events mirror names for it, or the platform chain, marked, when the
   * mirror holds no such event; the slug itself is not stored.
   */
  chainSlug?: string
  /** The record acted on. A value that is not a storable id costs the id, not the event. */
  id?: string | null
  /** The record's table, when it depends on the request (adminAuditSubject only). */
  table?: string
  /** Ids, counts and short codes, as platform audit metadata allows. */
  detail?: Record<string, unknown>
}

const subjects = new WeakMap<Request, AuditSubject>()

/** Note who passed the route's check. A later call adds to it, detail included. */
export function noteAuditSubject(req: Request, subject: Partial<AuditSubject>): void {
  const known = subjects.get(req)
  const merged = { ...known, ...subject } as AuditSubject
  if (known?.detail && subject.detail) merged.detail = { ...known.detail, ...subject.detail }
  subjects.set(req, merged)
}

/** The actor, chain, target and metadata of the event for this request. */
export function auditSubject(req: Request, table: string): Pick<AuditMutation, 'actor' | 'tenant' | 'target' | 'metadata'> {
  const s = subjects.get(req)
  return {
    actor: s ? { userId: s.userId } : { session: true },
    tenant: { tenantId: s?.tenantId ?? null },
    target: { table, id: s?.id ?? null },
    metadata: { ...(s?.eventSlug ? { event_slug: s.eventSlug } : {}), ...s?.detail },
  }
}

/**
 * The same for an admin-only route, whose check names no tenant: Stellr's chain, or, when
 * the route noted an event, that event owner's. A verified slug (eventSlug) is stored in
 * the metadata as well; an unverified one (chainSlug) only picks the chain. The actor is
 * the user the route noted, else the session's.
 */
export function adminAuditSubject(req: Request, table: string): Pick<AuditMutation, 'actor' | 'tenant' | 'target' | 'metadata'> {
  const s = subjects.get(req)
  const slug = s?.eventSlug ?? s?.chainSlug
  return {
    actor: s?.userId ? { userId: s.userId } : { session: true },
    tenant: slug ? { eventSlug: slug } : { stellr: true },
    target: { table: s?.table ?? table, id: s?.id ?? null },
    metadata: { ...(s?.eventSlug ? { event_slug: s.eventSlug } : {}), ...s?.detail },
  }
}
