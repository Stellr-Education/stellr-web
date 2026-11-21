import type { AuditMutation } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Platform audit for the signer's side of Stellr signing (docs/TENANCY-S5.md, C7). The
// signer has no account: the emailed link, or the session cookie it was exchanged for, is
// the key. So the actor is { userId: null }, which the row records as anonymous, and the
// recipient is the target. The envelope's own tenant picks the chain (NULL is Stellr's,
// not yet backfilled, as lib/esign/native/http.ts reads it). Nothing the signer typed
// (field values, a reason, a typed name, a birth year) goes in the event.
//
// withAudit records every answer but a 4xx, so a refused link (invalidLink is a 404)
// records nothing. An answer given before the session resolved has no recipient: it goes
// on the platform chain marked tenant_unresolved, as resolveTenant marks a chain it
// cannot name.

interface Signer {
  recipient: { id: string }
  envelope: { id: string; tenant_id?: string | null }
}

/** Note the recipient whose session passed, for the event this request writes. */
export function noteSigner(req: Request, ctx: Signer, detail: Record<string, unknown> = {}): void {
  noteAuditSubject(req, {
    userId: null,
    tenantId: ctx.envelope.tenant_id ?? STELLR_TENANT_ID,
    id: ctx.recipient.id,
    detail: { agreement_id: ctx.envelope.id, ...detail },
  })
}

/**
 * Everything but the action, for a route's withAudit spec. The spec itself stays a literal
 * in the route, `({ args: [req] }) => ({ action, ...signerEvent(req) })`, which is what the
 * audit gate reads as answering every time (lib/security/audit-coverage.ts).
 */
export function signerEvent(req: Request): Omit<AuditMutation, 'action'> {
  const { tenant, target, metadata } = auditSubject(req, 'agreement_recipients')
  const resolved = !!target?.id
  return {
    actor: { userId: null },
    tenant,
    target,
    metadata: resolved ? metadata : { ...metadata, tenant_unresolved: true },
  }
}
