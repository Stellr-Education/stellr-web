// The page body Stellr's tree and the tenant tree share (S5 wave 8, A12): each tree's
// page checks the event's owner first, then renders this.
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { Eyebrow } from '@stellr/web-ui'
import { getEventBySlug } from '@/lib/events/repo'
import { type StellarEvent } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import { supabaseServer } from '@/lib/supabase'
import { CHECK_IN_COOKIE, verifyCheckIn } from '@/lib/check-in'
import { loadCheckInView } from '@/lib/check-in-view'
import CheckInForm from '@/components/forms/CheckInForm'

// Token-gated and per-attendee — nothing here belongs in a search or answer
// engine index.

// Public check-in page reached by scanning the event QR code (in-person) or
// clicking the attendance link (virtual events). A phone that has checked in
// before is remembered (lib/check-in.ts) and lands on the participant's own page
// — company number, shirt size, event documents, survey — with or without the
// token, so it still works after check-in closes.
export default async function CheckInBody({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const [{ slug }, { t: token }] = await Promise.all([params, searchParams])

  const event = (await getEventBySlug(slug)) as (StellarEvent & { setting?: string }) | null
  if (!event) notFound()

  const isVirtual = event.setting === 'virtual'
  const rememberedId = verifyCheckIn(slug, (await cookies()).get(CHECK_IN_COOKIE)?.value)
  const initialView = rememberedId ? await loadCheckInView(supabaseServer(), slug, rememberedId) : null

  return (
    <div className="flex items-start justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md space-y-6 rounded-ds-card border border-line bg-white p-6 shadow-xs">
        <div className="text-center">
          <Eyebrow>{isVirtual ? 'Confirm your attendance' : 'Event check-in'}</Eyebrow>
          <h1 className="mt-1 font-display text-xl font-bold text-ink">{event.title}</h1>
          {event.date && <p className="mt-0.5 text-sm text-content-muted">{formatDate(event.date)}</p>}
        </div>
        <CheckInForm slug={slug} token={token ?? null} isVirtual={isVirtual} initialView={initialView} />
      </div>
    </div>
  )
}
