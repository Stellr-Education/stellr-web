import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail, MARKETING_FROM } from '@/lib/email'
import { LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'
import { checkSpamSignals } from '@/lib/spam-guard'
import { GATED_ASSETS } from '@/lib/gated-assets'
import { gatedDownloadUrl } from '@/lib/gated-download-link'
import { gatedAssetEmailHtml, gatedAssetEmailText } from '@/lib/gated-asset-email'

const PAPER = GATED_ASSETS['white-paper']
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/** Server-side validation, with caps (docs/REC-form-spam-hardening.md §5). */
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
})
/**
 * The /impact white paper. Like every gated download, the full file sits in
 * private storage and goes out only by email, as a signed link
 * (lib/gated-download-link.ts) — never from the page.
 */
export async function POST(req: Request) {
  // Sends outbound email to the submitted address — an email-bomb vector, so
  // throttle harder than the CRM-only forms.
  const limited = rateLimitGuard(req, 'white-paper', { limit: 3, windowMs: HOUR_MS })
  if (limited) return limited
  try {
    const body: unknown = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'A name and valid email are required.' }, { status: 400 })
    }
    // A tripped trap answers 200 and mails nobody.
    const spam = checkSpamSignals(body, req, 'white-paper')
    if (spam) return spam
    const { name: cleanName, email: cleanEmail } = parsed.data

    const downloadUrl = gatedDownloadUrl(SITE_URL, 'white-paper')
    if (!downloadUrl) {
      console.error('[white-paper] No signing secret configured — cannot issue a download link.')
      return NextResponse.json({ error: 'Downloads are unavailable right now.' }, { status: 503 })
    }

    const [firstName, ...rest] = cleanName.split(/\s+/)
    const lastName = rest.join(' ')

    // ── 1. Capture the lead in HubSpot (best-effort) ──────────────────────
    // Form submission + note engagement, so this shows up under Recent
    // Conversion and Last Activity rather than only as a mutated property.
    const crm = await captureLead({
      email: cleanEmail,
      firstName,
      lastName,
      source: 'white_paper',
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.white_paper,
      activity: `${PAPER.note}.`,
      logEntry: logLine('white_paper', PAPER.title),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}${PAPER.pagePath}`,
        pageName: 'White paper — STEM Power Skills',
      },
    })

    // ── 2. Email the signed link to the requester ────────────────────────
    // deep review PUB-2: the shared builder escapes the submitted name.
    let emailed = false
    try {
      await sendEmail({
        to: cleanEmail,
        from: MARKETING_FROM,
        subject: PAPER.subject,
        html: gatedAssetEmailHtml(firstName, PAPER.title, downloadUrl),
        text: gatedAssetEmailText(firstName, PAPER.title, downloadUrl),
      })
      emailed = true
    } catch (err) {
      console.error('[white-paper] Email send failed:', err)
    }

    // The link only ever travels by email, so a failed send is a failure.
    if (!emailed) return NextResponse.json({ error: 'We could not send the email.' }, { status: 502 })
    return NextResponse.json({ ok: true, emailed, crm: crm.ok })
  } catch (err) {
    console.error('[white-paper] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
