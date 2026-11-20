import CheckInCodeBody from './code-body'
import { isStellrEvent } from '@/lib/events/stellr-owner'

export const metadata = { title: 'Check-in code', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Stellr's check-in code page (S5 wave 8, A12; K11 canary probe P6). For another tenant's
// event it answers as for a code that is not valid, which is what a slug nobody has gets:
// the code is never read, and nothing says the event exists
// (e2e/tenancy/host-spoof.spec.ts holds the two answers equal). A failed owner read throws
// to the error boundary. The body is shared with the tenant tree, whose page checks its own
// owner (requireTenantEvent).
export default async function CheckInCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ c?: string }>
}) {
  const stellr = await isStellrEvent((await params).slug)
  return <CheckInCodeBody params={params} searchParams={stellr ? searchParams : Promise.resolve({})} />
}
