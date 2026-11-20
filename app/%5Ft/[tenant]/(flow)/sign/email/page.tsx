import type { Metadata } from 'next'
import { EmailChangeApp } from '@/components/esign/EmailChangeApp'
import { tenantFromParams } from '@/lib/tenancy/request-tenant'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Update an email address',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

// The bounce notice's one-time link on the tenant's own host (S5 wave 8, BOUNCE). No record
// to check here: the page reads nothing, and the key is in the URL fragment, which the server
// never sees. /api/sign/email answers a link only on its agreement's tenant's host.
export default async function TenantEmailChangePage({ params }: { params: Promise<{ tenant: string }> }) {
  await tenantFromParams(params)
  return <EmailChangeApp />
}
