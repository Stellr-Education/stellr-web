import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { DocusignsSection } from './DocusignsSection'

// Fictional people. The card is the member portal's "Agreements & Consent
// Forms" (also shown to admins on View as).
const meta: Meta = { title: 'Member/Agreements & Consent Forms' }
export default meta

const base = {
  envelope_type: 'minor',
  signer_name: 'Pat Example',
  signer_email: 'pat@example.com',
  minor_name: 'Sam Example',
  event_title: 'Regional Design Challenge',
  sent_at: '2026-11-09T18:30:52Z',
  completed_at: null,
  reminder_sent_at: null,
  signers_total: 2,
}

const parent = { name: 'Pat Example', email: 'pat@example.com', role_name: 'Guardian' }
const student = { name: 'Sam Example', email: 'sam@school.example', role_name: 'Minor' }

const frame = (children: React.ReactNode) => <div className="max-w-3xl bg-surface p-8">{children}</div>

export const ParentSignedStudentBounced: StoryObj = {
  render: () =>
    frame(
      <DocusignsSection
        adminDownload
        initialEnvelopes={[{
          ...base, id: 'a', status: 'sent', signers_completed: 1,
          recipients: [
            { ...parent, status: 'completed', delivered_at: '2026-11-17T20:37:54Z', signed_at: '2026-11-17T20:38:24Z' },
            { ...student, status: 'autoresponded', delivered_at: null },
          ],
        }]}
      />,
    ),
}

export const InProgressAndSettled: StoryObj = {
  render: () =>
    frame(
      <DocusignsSection
        initialEnvelopes={[
          {
            ...base, id: 'b', status: 'sent', signers_completed: 0,
            recipients: [
              { ...parent, status: 'delivered', delivered_at: '2026-11-10T09:00:00Z' },
              { ...student, status: 'sent', delivered_at: null },
            ],
          },
          {
            ...base, id: 'c', envelope_type: 'mentor', event_title: 'Winter Mentor Programme',
            signer_name: 'Alex Rivera', status: 'sent', signers_total: 1, signers_completed: 0,
            recipients: [{ name: 'Alex Rivera', email: 'alex@example.com', role_name: 'Mentor', status: 'sent', delivered_at: null }],
          },
          {
            ...base, id: 'd', status: 'completed', completed_at: '2026-10-02T15:00:00Z', signers_completed: 2,
            agreement_version: '2.3', event_title: 'Autumn Challenge',
            recipients: [
              { ...parent, status: 'completed', signed_at: '2026-10-01T15:00:00Z' },
              { ...student, status: 'completed', signed_at: '2026-10-02T15:00:00Z' },
            ],
          },
        ]}
      />,
    ),
}
