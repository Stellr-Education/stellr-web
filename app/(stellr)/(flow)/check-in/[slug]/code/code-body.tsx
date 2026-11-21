// The page body Stellr's tree and the tenant tree share (S5 wave 8, A12): each tree's
// page checks the event's owner first, then renders this.
import QRCode from 'qrcode'
import { Eyebrow } from '@stellr/web-ui'
import { getEventBySlug } from '@/lib/events/repo'
import { formatDate } from '@/lib/utils'
import { supabaseServer } from '@/lib/supabase'
import { checkInCodeUrl, verifyCheckInCode } from '@/lib/check-in-codes'
import { eventSiteOrigin } from '@/lib/tenancy/event-origin'

// Someone's check-in code, big enough to scan from a phone held up at the desk
// (Oct 2026). Reached from the button in a confirmation email, the teacher's
// "Your group" page, or a phone camera scanning a badge. A participant's code
// checks them in; a group's code opens the group's list at the desk.

export default async function CheckInCodeBody({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ c?: string }>
}) {
  const [{ slug }, { c }] = await Promise.all([params, searchParams])
  const code = verifyCheckInCode(slug, c)
  const db = supabaseServer()

  let name: string | null = null
  let note = ''
  if (code?.kind === 'p') {
    const { data } = await db
      .from('participants')
      .select('first_name, last_name, registrations!inner(event_slug, status)')
      .eq('id', code.id)
      .eq('registrations.event_slug', slug)
      .neq('registrations.status', 'withdrawn')
      .maybeSingle()
    if (data) {
      name = `${data.first_name} ${data.last_name}`
      note = 'Show this at the registration desk to check in.'
    }
  } else if (code?.kind === 'g') {
    const { data } = await db
      .from('registrations')
      .select('group_name, school_name, participants(id)')
      .eq('id', code.id)
      .eq('event_slug', slug)
      .neq('status', 'withdrawn')
      .maybeSingle()
    if (data) {
      const count = (data.participants as unknown[] | null)?.length ?? 0
      name = (data.group_name as string | null) || (data.school_name as string | null) || 'Your group'
      note = `Show this at the registration desk when your group arrives. Staff check in all ${count} at once, and you tell them who isn’t here.`
    }
  }

  const event = name ? ((await getEventBySlug(slug)) as { title?: string; date?: string } | null) : null
  // S5 wave 8, A12: the QR opens on the event's own host (the tenant's, rendered from the
  // tenant tree; Stellr's here). No origin, no QR, never one pointing at the wrong host.
  const origin = name && c ? await eventSiteOrigin(slug) : null
  const qr = name && c && origin ? await QRCode.toDataURL(checkInCodeUrl(slug, c, origin), { width: 640, margin: 2, errorCorrectionLevel: 'M' }) : null

  return (
    <div className="flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5 rounded-ds-card border border-line bg-white p-6 text-center shadow-xs">
        {name && qr ? (
          <>
            <div>
              <Eyebrow>Check-in code</Eyebrow>
              <h1 className="mt-1 break-words font-display text-2xl font-bold text-ink">{name}</h1>
              {event?.title && (
                <p className="mt-0.5 text-sm text-content-muted">
                  {event.title}
                  {event.date && <> · {formatDate(event.date)}</>}
                </p>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the QR encoder; nothing to optimise */}
            <img src={qr} alt={`Check-in QR code for ${name}`} className="mx-auto aspect-square w-full max-w-xs" />
            <p className="text-content-body">{note}</p>
            <p className="text-xs text-content-muted">Turn your screen brightness up if the desk can’t read it.</p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-bold text-ink">This check-in code isn’t valid</h1>
            <p className="text-content-body">Head to the registration desk and we’ll check you in by name.</p>
          </>
        )}
      </div>
    </div>
  )
}
