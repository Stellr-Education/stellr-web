import { supabaseServer } from '@/lib/supabase'
import { submitLink, viewLink } from '@/lib/esign/email-changes'
import { invalidLink, json, readJson, sameOrigin, throttle } from '@/lib/esign/native/http'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/sign/email — the one-time link in a bounce notice to the other
// signer on a two-person form (lib/esign/email-changes.ts).
//
//   body { token }           → what the page shows (the link is not spent)
//   body { token, email }    → a parent's correction (applied) or a student's
//                              suggestion (waits for an adult)
//
// The token travels in the body, never the URL, as the signing link does. A
// link that no longer works gets one answer whatever the reason.

// Signed out by design: the link is the key. The row records the answer, never the token.
// S5 wave 8, BOUNCE: on the chain of the host's tenant, which the handler notes (a link
// answers only on its agreement's tenant's host). Before the note, the platform chain unplaced.
const auditSpec = ({ args: [req] }: { args: [Request] }) => {
  const placed = auditSubject(req, 'agreement_email_changes').tenant
  return {
    action: 'agreement.email_link.use' as const,
    actor: { session: true } as const,
    tenant: placed,
    target: { table: 'agreement_email_changes', id: null },
  }
}

export const POST = withAudit(auditSpec, useLink)

async function useLink(req: Request) {
  const limited = await throttle(req, 'email-change', 20)
  if (limited) return limited
  if (!sameOrigin(req)) return json({ error: 'Forbidden' }, 403)
  const body = await readJson<{ token?: unknown; email?: unknown }>(req)
  const db = supabaseServer()
  // S5 wave 8, BOUNCE: a link answers only on its agreement's tenant's host.
  const hostTenantId = (await requestTenant()).tenantId
  noteAuditSubject(req, { tenantId: hostTenantId })

  if (body?.email === undefined) {
    const view = await viewLink(db, body?.token, undefined, hostTenantId)
    return view ? json({ state: 'ready', view }) : invalidLink()
  }

  const result = await submitLink(db, { token: body?.token, email: body.email, hostTenantId })
  if (!result.ok) {
    if (result.code === 'LINK') return invalidLink()
    return json({ error: result.error, code: result.code }, result.status)
  }
  return json({ ok: true, outcome: result.outcome })
}
