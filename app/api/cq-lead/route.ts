import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CQ_LP_AUDIENCE, CQ_PROGRAM_INTEREST, HS, LEAD_SOURCE_LIFECYCLE } from '@/lib/hubspot-fields'
import { captureLead, logLine, readHubspotCookie } from '@/lib/hubspot'
import { HOUR_MS, rateLimitGuard } from '@/lib/rate-limit'
import { getCurriculumLandingPage } from '@/content/lp'
import { checkSpamSignals } from '@/lib/spam-guard'
import { cqLeadFields as f } from './schema'

/**
 * Classroom Qualifier curriculum request.
 *
 * The sibling of /api/lp-lead for the curriculum pages. Same orchestrator
 * (captureLead: form submission, note, activity log, lifecycle stage,
 * dead-letter alert), its own HubSpot form — the handover's
 * cq-curriculum-request — because it carries fields the Landing Page form does
 * not declare.
 *
 * Teacher data only. The handover's minors rule: nothing here may identify a
 * student, so the form asks for a students *band*, never names.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const utm = z.string().max(200).optional()

const cqLeadSchema = z.object({
  firstName: f.firstName,
  lastName: f.lastName,
  email: f.email,
  school: f.school,
  subject: f.subject,
  studentsBand: f.studentsBand,
  theme: f.theme,
  grantInterest: f.grantInterest,
  consent: f.consent,
  pageSlug: z.string().min(1).max(120),
  utm_source: utm,
  utm_medium: utm,
  utm_campaign: utm,
  utm_content: utm,
  utm_term: utm,
})

export async function POST(req: Request) {
  // Same budget as /api/lp-lead: room for a mistyped email, not for a script.
  const limited = rateLimitGuard(req, 'cq-lead', { limit: 5, windowMs: HOUR_MS })
  if (limited) return limited

  try {
    const body: unknown = await req.json()
    const parsed = cqLeadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
    }
    const spam = checkSpamSignals(body, req, 'cq-lead')
    if (spam) return spam
    const data = parsed.data

    // Only slugs we publish, so lp_source_page stays a clean reporting key.
    const config = getCurriculumLandingPage(data.pageSlug)
    if (!config) {
      return NextResponse.json({ error: 'Unknown page' }, { status: 400 })
    }

    // Built by omission: HubSpot writes '' straight over an existing value.
    const properties: Record<string, string> = {
      [HS.stellrRole]: 'teacher',
      [HS.school]: data.school,
      [HS.lpAudience]: CQ_LP_AUDIENCE,
      [HS.lpSourcePage]: config.leadSource,
      [HS.lpProgramInterest]: CQ_PROGRAM_INTEREST,
      [HS.cqTheme]: data.theme,
      [HS.cqWindow]: config.window,
      [HS.cqTeacherGrantInterest]: data.grantInterest ? 'true' : 'false',
      [HS.cqStudentsBand]: data.studentsBand,
      [HS.cqCourseSubject]: data.subject,
      ...(data.utm_source ? { [HS.lpUtmSource]: data.utm_source } : {}),
      ...(data.utm_medium ? { [HS.lpUtmMedium]: data.utm_medium } : {}),
      ...(data.utm_campaign ? { [HS.lpUtmCampaign]: data.utm_campaign } : {}),
      ...(data.utm_content ? { [HS.lpUtmContent]: data.utm_content } : {}),
      ...(data.utm_term ? { [HS.lpUtmTerm]: data.utm_term } : {}),
    }

    const detail = [
      config.leadSource,
      data.theme,
      `${data.studentsBand} students`,
      data.grantInterest ? 'Teacher Grant interest' : null,
    ]
      .filter(Boolean)
      .join(' · ')

    const result = await captureLead({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      source: 'classroom_qualifier',
      properties,
      lifecycleStage: LEAD_SOURCE_LIFECYCLE.classroom_qualifier,
      activity: `Classroom Qualifier curriculum request — /lp/${config.slug} (${detail}).`,
      logEntry: logLine('classroom_qualifier', detail),
      context: {
        hutk: readHubspotCookie(req),
        pageUri: `${SITE_URL}/lp/${config.slug}`,
        pageName: config.seo.title,
      },
    })

    // 200 either way, with `stored` saying whether the lead landed. The visitor
    // still gets the curriculum link: a teacher turned away at the last step is
    // worse than a lead we reconcile from the dead-letter alert.
    return NextResponse.json({ ok: result.ok, stored: result.via !== 'none' })
  } catch (err) {
    console.error('[cq-lead] Unexpected error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
