import { supabaseServer } from '@/lib/supabase'
import { ActivityLogReview } from '@/components/admin/ActivityLogReview'
import { DeletionRequestsReview, type DeletionRequest } from '@/components/admin/DeletionRequestsReview'
import { authz } from '@/lib/authz'
import { stellrRows } from '@/lib/tenancy/stellr-scope'

export const metadata = { title: 'Admin — Activity Log Review' }

export default async function ActivityLogPage() {
  await authz.page.requireCapability('portal:read', { route: '/admin/activity-log' })
  const db = supabaseServer()

  const [{ data: participations }, { data: deletionRequests }] = await Promise.all([
    stellrRows(db
      .from('event_participations')
      .select(`
        id, event_year, event_location, team_name, award, status, created_at,
        members(id, first_name, last_name, email)
      `))
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    db
      .from('deletion_requests')
      .select('id, entity_type, entity_id, reason, status, created_at, requested_by, members:requested_by(first_name, last_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
  ])

  return (
    <div className="space-y-10">
      <DeletionRequestsReview initialRequests={(deletionRequests ?? []) as DeletionRequest[]} />
      <ActivityLogReview initialItems={participations ?? []} />
    </div>
  )
}
