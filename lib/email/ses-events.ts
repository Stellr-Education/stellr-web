// Amazon SES event publishing → email_events rows (email plan F).
// https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
//
// One SES event can name several recipients (a bounce or complaint lists each),
// so it maps to one row per recipient. Tags come back as arrays of strings.

import { contextFromTags, type EmailEventType, type MappedEmailEvent } from './events'

interface SesRecipient { emailAddress?: string; diagnosticCode?: string }
export interface SesEvent {
  eventType?: string
  notificationType?: string
  mail?: { messageId?: string; timestamp?: string; destination?: string[]; tags?: Record<string, string[]> }
  bounce?: { bounceType?: string; bounceSubType?: string; bouncedRecipients?: SesRecipient[]; timestamp?: string }
  complaint?: { complainedRecipients?: SesRecipient[]; timestamp?: string; complaintFeedbackType?: string }
  delivery?: { recipients?: string[]; timestamp?: string }
  deliveryDelay?: { delayedRecipients?: SesRecipient[]; timestamp?: string; delayType?: string }
  reject?: { reason?: string }
}

const TYPE: Record<string, EmailEventType> = {
  Send: 'sent',
  Delivery: 'delivered',
  Bounce: 'bounced',
  Complaint: 'complained',
  Reject: 'failed',
  DeliveryDelay: 'delivery_delayed',
}

const short = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

export function mapSesEvent(event: SesEvent): MappedEmailEvent[] {
  const kind = event.eventType ?? event.notificationType ?? ''
  const type = TYPE[kind]
  const id = event.mail?.messageId
  if (!type || !id) return []
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(event.mail?.tags ?? {})) if (Array.isArray(v) && typeof v[0] === 'string') tags[k] = v[0]
  const ctx = contextFromTags(tags)
  const at = (t?: string) => (t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : new Date(event.mail?.timestamp ?? Date.now()).toISOString())

  let recipients: string[] = []
  let occurredAt = at(event.mail?.timestamp)
  const payloadMin: Record<string, unknown> = {}
  if (type === 'bounced') {
    recipients = (event.bounce?.bouncedRecipients ?? []).map((r) => r.emailAddress ?? '')
    occurredAt = at(event.bounce?.timestamp)
    payloadMin.bounce = {
      ...(short(event.bounce?.bounceType, 40) ? { type: short(event.bounce?.bounceType, 40) } : {}),
      ...(short(event.bounce?.bounceSubType, 60) ? { sub_type: short(event.bounce?.bounceSubType, 60) } : {}),
      ...(short(event.bounce?.bouncedRecipients?.[0]?.diagnosticCode, 300) ? { message: short(event.bounce?.bouncedRecipients?.[0]?.diagnosticCode, 300) } : {}),
    }
  } else if (type === 'complained') {
    recipients = (event.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress ?? '')
    occurredAt = at(event.complaint?.timestamp)
  } else if (type === 'delivered') {
    recipients = event.delivery?.recipients ?? []
    occurredAt = at(event.delivery?.timestamp)
  } else if (type === 'delivery_delayed') {
    recipients = (event.deliveryDelay?.delayedRecipients ?? []).map((r) => r.emailAddress ?? '')
    occurredAt = at(event.deliveryDelay?.timestamp)
  } else {
    recipients = event.mail?.destination ?? []
    if (type === 'failed' && short(event.reject?.reason, 300)) payloadMin.reason = short(event.reject?.reason, 300)
  }

  return recipients
    .filter((r) => typeof r === 'string' && r.includes('@') && r.length <= 320)
    .map((recipient) => ({ provider: 'ses' as const, providerEmailId: id, type, recipient, occurredAt, linkUrl: null, payloadMin, tags: ctx }))
}

/** Is this a permanent bounce (suppress) — SES says "Permanent". */
export const isPermanentBounce = (event: SesEvent) => (event.bounce?.bounceType ?? '').toLowerCase() === 'permanent'
