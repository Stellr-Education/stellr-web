import CheckInBody from './check-in-body'
import { requireStellrEvent } from '@/lib/events/stellr-owner'

export const metadata = { title: 'Event Check-In', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// Stellr's check-in page (S5 wave 8, A12; K11 canary probe P6). Another tenant's event is
// not found here, as a slug nobody has is: its check-in is on the tenant's own host. A failed
// owner read throws to the error boundary. The body is shared with the tenant tree, whose
// page checks its own owner (requireTenantEvent).
export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  await requireStellrEvent((await params).slug)
  return <CheckInBody params={params} searchParams={searchParams} />
}
