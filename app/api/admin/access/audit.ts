import type { AccessObject, AccessObjectType } from '@/lib/access-objects'
import { storableId } from '@/lib/audit/route'
import { noteAuditSubject } from '@/lib/audit/route-subject'

// Platform audit for the access routes (docs/TENANCY-S5.md, C7): what each request acted
// on, for the withAudit spec, which runs after the handler and cannot read the body again.

const TABLE: Partial<Record<AccessObjectType, string>> = {
  space: 'community_spaces',
  course: 'training_modules',
  resource: 'community_resources',
}

/**
 * Note the object a request acted on as the event's target. A container-backed object is
 * its mentoring_cohorts row. An event or campaign container (event_participation,
 * campaign_participation: what event-sync creates) belongs to its event, so the row goes on
 * that event owner's chain by the container's campaign_ref, a slug read from the database
 * with the container, not one the caller supplied. An event or campaign keyed by its slug
 * has no row here, and resolveAccessObject takes that slug from the URL without looking it
 * up, so it is never stored: it only picks the chain, which the events mirror verifies
 * (platform chain, marked, when the mirror has no such event).
 */
export function noteAccessObject(req: Request, object: AccessObject, detail: Record<string, unknown> = {}): void {
  const eventLike = object.objectType === 'event' || object.objectType === 'campaign'
  const slugKeyed = !object.containerId && eventLike
  const eventContainer = !!object.containerId && eventLike && !!object.slug
  noteAuditSubject(req, {
    table: object.containerId ? 'mentoring_cohorts' : (TABLE[object.objectType] ?? 'events'),
    id: slugKeyed ? null : storableId(object.containerId ?? object.ref),
    ...(slugKeyed && object.slug ? { chainSlug: object.slug } : {}),
    ...(eventContainer ? { eventSlug: object.slug } : {}),
    detail: { object_type: object.objectType, ...detail },
  })
}
