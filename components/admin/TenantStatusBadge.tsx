import { Badge } from '@stellr/web-ui'
import type { TenantStatus } from '@/lib/console/tenants'

const TONES: Record<TenantStatus, string> = {
  active: 'bg-enviro-green-bg text-enviro-green-text',
  suspended: 'bg-danger/10 text-danger',
  provisioning: 'bg-pathway-amber-bg text-ink',
  archived: 'bg-line text-content-muted',
}

/** S6-CON: a tenant's status, coloured by what it means for its hosts. */
export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return <Badge className={TONES[status]}>{status}</Badge>
}
