import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { SignerStatusList } from './SignerStatus'

const meta: Meta = { title: 'Primitives/SignerStatusList' }
export default meta

const frame = (children: React.ReactNode) => <div className="max-w-xs space-y-6 p-8">{children}</div>

export const ParentSignedStudentBounced: StoryObj = {
  render: () =>
    frame(
      <SignerStatusList
        signers={[
          { id: '1', role: 'Parent', tone: 'done', status: 'Signed Nov 17, 2026' },
          { id: '2', role: 'Student', tone: 'attention', status: 'Email bounced' },
        ]}
      />,
    ),
}

export const AllTones: StoryObj = {
  render: () =>
    frame(
      <>
        <SignerStatusList
          signers={[
            { id: '1', role: 'Parent', tone: 'waiting', status: 'Opened, not signed' },
            { id: '2', role: 'Student', tone: 'queued', status: 'After parent signs' },
          ]}
        />
        <SignerStatusList signers={[{ id: '3', role: 'Mentor', name: 'Alex Rivera', tone: 'waiting', status: 'Not opened' }]} />
        <SignerStatusList signers={[{ id: '4', role: 'Participant', tone: 'attention', status: 'Declined' }]} />
      </>,
    ),
}
