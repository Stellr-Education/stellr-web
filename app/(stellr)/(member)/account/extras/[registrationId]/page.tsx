import type { Metadata } from 'next'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { AddExtras } from '@/components/member/AddExtras'

// Add extras to a registration after registering (docs/PLAN-event-add-ons-2026-11-17.md, Phase 2):
// accommodation, experiences and event merch. Organisers book for their group;
// everyone else books for themselves. The API checks who may do what.

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Add extras', robots: { index: false, follow: false } }

export default async function AddExtrasPage({
  params,
  searchParams,
}: {
  params: Promise<{ registrationId: string }>
  searchParams: Promise<{ paid?: string; cancelled?: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const { registrationId } = await params
  const { paid, cancelled } = await searchParams
  return (
    <div className="mx-auto w-full max-w-content px-4 py-10">
      <AddExtras registrationId={registrationId} paid={paid === '1'} cancelled={cancelled === '1'} />
    </div>
  )
}
