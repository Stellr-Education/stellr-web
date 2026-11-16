import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdminClaims } from '@/lib/admin-auth'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { resolveAudience, type Audience } from '@/lib/email-campaigns'

const schema = z.object({
  activeOnly: z.boolean().optional(),
  excludeMinors: z.boolean().optional(),
  tierIds: z.array(z.guid()).nullable().optional(),
})

// POST /api/admin/email/audience/preview — recipient count for a filter, with
// consent suppression applied. Lets the campaign form show reach before sending.
//
// Platform audit (docs/TENANCY-S5.md, C7): it writes nothing, but it reads who would be
// reached, so it is recorded: the filter's shape and the count, never who.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'email.audience.preview', ...adminAuditSubject(req, 'members') }),
  previewAudience,
)

async function previewAudience(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const members = await resolveAudience(parsed.data as Audience)
    noteAuditSubject(req, { detail: { recipients: members.length, tier_ids: parsed.data.tierIds?.length ?? 0 } })
    return NextResponse.json({ count: members.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
