import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TierTable } from './TierTable'

const meta: Meta<typeof TierTable> = {
  title: 'Membership/TierTable',
  component: TierTable,
  args: {
    caption: 'Teacher membership tiers',
    guaranteeDays: 45,
    guaranteeHref: '/terms#guarantee',
    tiers: [
      { id: 'educator', name: 'Educator', role: 'Everyone starts here', price: 'Free', priceNote: 'always', highlights: ['Competition material', 'Teacher and student guides'], cta: { label: 'Start free', href: '#' } },
      { id: 'catalyst', name: 'Catalyst', role: 'Full material & PD hours', price: '$149', priceNote: 'per year', featured: true, highlights: ['Lesson plans and worksheets', 'PD hours'], cta: { label: 'Compare Catalyst', href: '#' } },
      { id: 'innovator', name: 'Innovator', role: 'Live feedback & mentoring', price: '$499', priceNote: 'per year', highlights: ['Biweekly group call'], cta: { label: 'Compare Innovator', href: '#' } },
      { id: 'trailblazer', name: 'Trailblazer', role: 'Standards, SCORM & awards', price: '$999', priceNote: 'per year', highlights: ['Standards alignment', 'SCORM'], cta: { label: 'Compare Trailblazer', href: '#' } },
    ],
  },
}
export default meta

type Story = StoryObj<typeof TierTable>

/** The teacher ladder, as on the Classroom Qualifier pages. Prices here are story data. */
export const Teachers: Story = {
  render: (args) => (
    <div className="max-w-content p-8">
      <TierTable {...args} />
    </div>
  ),
}
