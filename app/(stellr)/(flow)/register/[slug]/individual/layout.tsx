import type { ReactNode } from 'react'
import { requireStellrEvent } from '@/lib/events/stellr-owner'

// Another tenant's event answers here as one nobody has (S5 K11 probe P4): the page's
// shared body is the tenant tree's too, which checks its own owner first
// (requireTenantEvent), so Stellr's check sits in Stellr's tree, beside the page. A failed
// owner read throws to the error boundary. Stellr's own events render as ever.
export default async function StellrIndividualRegistrationLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  await requireStellrEvent((await params).slug)
  return children
}
