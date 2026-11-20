import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventEmailHistory } from './EventEmailHistory'
import type { EventEmailSendRow, RecipientSendStatus } from '@/lib/event-emails/types'

// History shows an email's runs as ONE send with a plain status, counts by
// outcome, and a per-person list (17 Nov 2026: a consent email that went out
// in four runs read as four blasts, with no way to tell if everyone had it).

vi.mock('@/components/admin/RecordLinks', () => ({ MemberLink: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const run = (id: string, startedAt: string, list: [string, RecipientSendStatus][], over: Partial<EventEmailSendRow> = {}): EventEmailSendRow => ({
  id, event_email_id: 'e1', email_name: 'Outstanding consent form', subject: 'Consent outstanding',
  audiences: ['docusign_outstanding'], trigger: 'schedule', triggered_by: 'schedule',
  recipient_count: list.length, sent_count: 0, failed_count: 0, docusign_resent: 0,
  recipients: list.map(([email, status]) => ({ email, name: email.split('@')[0], roles: ['guardian'], status })),
  started_at: startedAt, finished_at: startedAt, ...over,
})

describe('EventEmailHistory', () => {
  it('shows several runs as one finished send, and lists problems first when opened', async () => {
    const history = [
      run('s2', '2026-11-17T17:07:00Z', [['bo@example.com', 'sent'], ['cy@example.com', 'sending']]),
      run('s1', '2026-11-17T15:56:00Z', [['al@example.com', 'sent'], ['bo@example.com', 'not_reached'], ['cy@example.com', 'not_reached'], ['di@example.com', 'not_reached']]),
    ]
    render(<EventEmailHistory history={history} emails={[{ id: 'e1', status: 'sent', updated_at: '2026-11-17T17:08:00Z' }]} />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(2) // header + ONE send
    expect(screen.getByText('Finished — check below')).toBeTruthy()
    expect(screen.getByText('2 delivered')).toBeTruthy()
    expect(screen.getByText('1 unconfirmed')).toBeTruthy()
    expect(screen.getByText('1 left the group')).toBeTruthy()

    await userEvent.click(rows[1])
    expect(screen.getByRole('button', { name: 'Needs a look (1)' })).toBeTruthy()
    const detail = screen.getAllByRole('table')[1]
    expect(within(detail).getByText('cy@example.com')).toBeTruthy()
    expect(within(detail).queryByText('al@example.com')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Everyone (4)' }))
    expect(within(screen.getAllByRole('table')[1]).getByText('al@example.com')).toBeTruthy()
  })

  it('a send waiting for Resume now offers to open the email', async () => {
    const onOpenEmail = vi.fn()
    const history = [run('s1', '2026-11-17T15:56:00Z', [['al@example.com', 'sent'], ['bo@example.com', 'not_reached']])]
    render(<EventEmailHistory history={history} emails={[{ id: 'e1', status: 'sending', updated_at: '2026-11-17T15:57:00Z' }]} onOpenEmail={onOpenEmail} />)
    expect(screen.getByText('Paused part-way')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open to resume' }))
    expect(onOpenEmail).toHaveBeenCalledWith('e1')
  })
})
