import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { checkSpamSignals } from '@/lib/spam-guard'
import { joinNetworkFields as f } from './schema'

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'

/** Server-side validation, with caps (docs/REC-form-spam-hardening.md §5). */
const joinNetworkSchema = z.object({
  firstName: f.firstName,
  lastName: f.lastName,
  email: f.email,
  phone: f.phone,
  companyName: f.companyName,
  address: f.address,
  whatYouDo: f.whatYouDo,
  reason: f.reason,
})

// deep review PUB-2: unauthenticated public form; its values go into a
// Stellr-branded HTML email to staff. Escape every value before the HTML so a
// submission can't inject markup (matches the teacher-grant route's helper).
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, 'join-network', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const body: unknown = await req.json()
    const parsed = joinNetworkSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const spam = checkSpamSignals(body, req, 'join-network')
    if (spam) return spam
    const {
      firstName, lastName, email, phone,
      companyName, address, whatYouDo, reason,
    } = parsed.data

    const name = `${firstName} ${lastName}`
    const rows: [string, string][] = [
      ['Name', esc(name)],
      ['Email', `<a href="mailto:${esc(email)}">${esc(email)}</a>`],
      ['Phone', esc(phone)],
      ['Company', esc(companyName)],
      ['Address', esc(address) || '—'],
      ['What they do', esc(whatYouDo)],
      ['Partner type', esc(reason)],
    ]
    const htmlRows = rows
      .map(([label, value]) => `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6">${label}</td><td style="padding:8px">${value}</td></tr>`)
      .join('')

    const subject = `[Join The Network] ${name} — ${companyName}`
    const html = `
      <h2>New Join The Stellr Network submission</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px">${htmlRows}</table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Sent via the Stellr Education website Join The Network form.</p>
    `
    const text = [
      'New Join The Stellr Network submission', '',
      `Name: ${name}`, `Email: ${email}`, `Phone: ${phone}`,
      `Company: ${companyName}`, `Address: ${address || '—'}`,
      `What they do: ${whatYouDo}`, `Partner type: ${reason}`,
    ].join('\n')

    await sendEmail({ to: CONTACT_EMAIL, replyTo: email, subject, html, text })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[join-network] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
