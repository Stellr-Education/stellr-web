import Link from '@/components/ui/SiteLink'
import { ArrowRight } from 'lucide-react'
import { Orbit, Environment } from '@stellr/icons'
import { CampaignCardAction } from './CampaignMemberAware'
import { CardPills } from '@/components/ui/CardPills'
import { CoverImage } from '@/components/ui/CoverImage'
import { RegistrationStatusPill } from '@/components/ui/RegistrationStatusPill'
import type { CampaignCardData } from '@/lib/campaigns'

export type CampaignCardVM = CampaignCardData

// Classroom Qualifier card for the unified /events board. EventCard (the
// Challenge card) is the standard: same image header, pill row + status pill,
// meta, and footer — action on the left, details link on the right. The amber
// "Classroom Qualifier" pill is what tells the two apart. Registration routes
// to the shared group flow (/register/[slug]/group).
export function CampaignCard({ campaign }: { campaign: CampaignCardVM }) {
  const ThemeIcon = campaign.theme === 'enviro' ? Environment : Orbit
  const isOpen = campaign.status === 'open'

  return (
    <article className="bg-white rounded-xl shadow-xs border border-line-light overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image header — same footprint as EventCard */}
      <div className="relative h-44 bg-gradient-to-br from-brand-blue-dark to-blue-900 flex items-center justify-center">
        {campaign.image ? (
          <CoverImage image={campaign.image} alt={campaign.title} />
        ) : (
          <ThemeIcon className="h-10 w-10 text-blue-300 opacity-60" />
        )}
      </div>

      <div className="p-5 flex flex-col flex-1">
        {/* Standardised three-pill row (Qualifier · Grade · Theme) + status */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <CardPills kind="campaign" gradeLevel={campaign.gradeLevel} theme={campaign.theme} />
          <RegistrationStatusPill status={campaign.status} />
        </div>

        <h3 className="font-bold text-brand-blue-dark mb-1 leading-snug">{campaign.title}</h3>

        {campaign.seasonLabel && <p className="text-sm text-content-muted">{campaign.seasonLabel}</p>}
        {campaign.deadlineLabel && (
          <p className="text-sm text-content-muted">Proposal due {campaign.deadlineLabel}</p>
        )}

        {campaign.tagline && (
          <p className="mt-2 text-sm text-brand-grey-dark line-clamp-2">{campaign.tagline}</p>
        )}

        <div className="mt-auto pt-4 flex items-center gap-4">
          {/* Registered state fills in in the browser, so /events can be cached. */}
          <CampaignCardAction slug={campaign.slug} isOpen={isOpen} registered={campaign.registered} />
          <Link
            href={`/events/${campaign.slug}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
          >
            Qualifier details <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  )
}
