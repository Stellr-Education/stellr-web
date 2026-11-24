import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { recordMappedEmailEvent } from '@/lib/email/events'
import { recordSuppression } from '@/lib/email/suppressions'
import { isPermanentBounce, mapSesEvent, type SesEvent } from '@/lib/email/ses-events'
import { isSnsSubscribeUrl, verifySnsMessage, type SnsMessage } from '@/lib/email/sns'
import { withAudit } from '@/lib/audit/route'
import { noteWebhook, webhookAudit, webhookEvent } from '@/lib/audit/webhook'

// POST /api/webhooks/ses — the SES standby's delivery events, through Amazon SNS
// (email plan F). SES configuration set stellr-email-standby publishes to the
// SNS topic named in SES_SNS_TOPIC_ARN, which is subscribed here over HTTPS.
//
// Every message must carry a valid SNS signature and come from that topic; any
// other is refused. A SubscriptionConfirmation is confirmed by fetching its
// SubscribeURL (an SNS host only). A Notification is stored in email_events like
// Resend's, and a permanent bounce or a complaint goes on the suppression list.
// Idempotent: SNS redelivers, and a repeat changes nothing.

export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => webhookAudit('webhook.event.process', webhookEvent('ses', req)),
  handleSnsMessage,
)

async function handleSnsMessage(req: Request) {
  const topic = process.env.SES_SNS_TOPIC_ARN
  if (!topic) {
    console.error('[webhooks/ses] SES_SNS_TOPIC_ARN not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }
  const raw = await req.text()
  if (raw.length > 256_000) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  if (!(await verifySnsMessage(parsed))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  const body = parsed as SnsMessage
  if (body.TopicArn !== topic) return NextResponse.json({ error: 'Unknown topic' }, { status: 403 })
  noteWebhook(req, { metadata: { event_type: body.Type } })

  if (body.Type === 'SubscriptionConfirmation') {
    if (!body.SubscribeURL || !isSnsSubscribeUrl(body.SubscribeURL)) return NextResponse.json({ error: 'Bad subscribe URL' }, { status: 400 })
    const res = await fetch(body.SubscribeURL)
    if (!res.ok) return NextResponse.json({ error: 'Confirmation failed' }, { status: 502 })
    return NextResponse.json({ confirmed: true })
  }
  if (body.Type !== 'Notification') return NextResponse.json({ ignored: body.Type })

  let event: SesEvent
  try {
    event = JSON.parse(body.Message) as SesEvent
  } catch {
    return NextResponse.json({ ignored: 'unparseable message' })
  }
  const db = supabaseServer()
  const mapped = mapSesEvent(event)
  let failed = 0
  for (const m of mapped) {
    try {
      await recordMappedEmailEvent(db, m)
    } catch (err) {
      failed++
      console.error('[webhooks/ses] event not recorded:', err instanceof Error ? err.message : err)
    }
    try {
      if (m.type === 'complained') await recordSuppression(db, { email: m.recipient, reason: 'complaint', source: 'ses-complaint' })
      else if (m.type === 'bounced' && isPermanentBounce(event)) await recordSuppression(db, { email: m.recipient, reason: 'bounce', source: 'ses-bounce' })
    } catch (err) {
      failed++
      console.error('[webhooks/ses] suppression not recorded:', err instanceof Error ? err.message : err)
    }
  }
  // A failure returns 500 so SNS retries; everything above is idempotent.
  if (failed) return NextResponse.json({ error: 'Not all recorded' }, { status: 500 })
  return NextResponse.json({ recorded: mapped.length })
}
