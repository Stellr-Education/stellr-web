import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { checkSpamSignals } from '@/lib/spam-guard'
import { hostEventFields as f, numberAsText } from './schema'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/** Server-side validation, with caps (docs/REC-form-spam-hardening.md §5). */
const hostEventSchema = z.object({
  firstName: f.firstName,
  lastName: f.lastName,
  email: f.email,
  phone: f.phone,
  companySchool: f.companySchool,
  address: f.address,
  venueCapacity: numberAsText(f.venueCapacity),
  preferredTiming: numberAsText(f.preferredTiming),
  preferredDuration: numberAsText(f.preferredDuration),
  funding: f.funding,
  facilityOverheads: f.facilityOverheads,
})

// deep review PUB-2: this is an unauthenticated public form whose values are
// interpolated into a Stellr-branded HTML email to staff. Escape every value
// before it reaches the HTML so a submission can't inject markup (matches the
// teacher-grant route's helper).
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'host-event', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const body: unknown = await req.json()
    const parsed = hostEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const spam = checkSpamSignals(body, req, 'host-event')
    if (spam) return spam
    const {
      firstName, lastName, email, phone,
      companySchool, address, venueCapacity,
      preferredTiming, preferredDuration,
      funding, facilityOverheads,
    } = parsed.data

    const name = `${firstName} ${lastName}`
    const rows: [string, string][] = [
      ['Name', esc(name)],
      ['Email', `<a href="mailto:${esc(email)}">${esc(email)}</a>`],
      ['Phone', esc(phone)],
      ['Organization', esc(companySchool)],
      ['Address', esc(address) || '—'],
      ['Venue Capacity', esc(venueCapacity)],
      ['Preferred Timing', esc(preferredTiming)],
      ['Preferred Duration', esc(preferredDuration)],
      ['Funding Available', esc(funding) || '—'],
      ['Facility Overheads', esc(facilityOverheads) || '—'],
    ]
    const htmlRows = rows
      .map(([label, value]) => `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">${label}</td><td style="padding:8px">${value}</td></tr>`)
      .join('')

    const subject = `[Host An Event] Expression of interest from ${name} — ${companySchool}`
    const html = `
      <h2>New Host An Event submission</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website Host An Event form.</p>
    `
    const text = [
      'New Host An Event submission', '',
      `Name: ${name}`, `Email: ${email}`, `Phone: ${phone}`,
      `Organization: ${companySchool}`, `Address: ${address || '—'}`,
      `Venue Capacity: ${venueCapacity}`, `Preferred Timing: ${preferredTiming}`,
      `Preferred Duration: ${preferredDuration}`,
      `Funding Available: ${funding || '—'}`, `Facility Overheads: ${facilityOverheads || '—'}`,
    ].join('\n')

    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, subject, html, text })

    // Capture the host enquiry as a marketing lead in HubSpot (best-effort —
    // never blocks the submission if the CRM is unreachable; a failed capture
    // is dead-lettered and alerted rather than lost).
    await captureLead({
      email,
      firstName,
      lastName,
      source: 'host_event',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.host_event,
      activity: `Host An Event enquiry — ${companySchool}.`,
      logEntry: logLine('host_event', companySchool),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}/host-an-event`,
        pageName: 'Host An Event enquiry',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[host-event] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
