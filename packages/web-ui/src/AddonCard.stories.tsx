import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AddonCard } from './AddonCard'

const meta: Meta = { title: 'Competition/AddonCard' }
export default meta

/** Optional extras on an event page: a night's accommodation, a tour, event merch. */
export const Extras: StoryObj = {
  render: () => (
    <div className="grid max-w-content gap-4 p-8 sm:grid-cols-3">
      <AddonCard
        kindLabel="Accommodation"
        title="Friday night, 5 March"
        dateLabel="Fri 5 Mar 2027"
        includes={['Dinner Friday', 'Breakfast Saturday']}
        priceLabel="$95 per person"
        footnote="Under-18s book through their group."
      />
      <AddonCard
        kindLabel="Experience"
        title="SpaceX half-day tour"
        dateLabel="Sun 7 Mar 2027, morning"
        description="A guided half-day tour, with transport from the venue."
        priceLabel="$20 per person"
        availability="limited"
      />
      <AddonCard kindLabel="Event merch" title="Event hoodie" priceLabel="From $38" availability="sold_out" />
    </div>
  ),
}
