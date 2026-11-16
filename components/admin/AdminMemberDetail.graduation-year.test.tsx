import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminMemberDetail } from './AdminMemberDetail'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

// alumni.mentor-upgrade: staff set or correct members.graduation_year, which
// the July-1 Alumni upgrade reads, on the member's profile form.
const member = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', member_code: null,
  first_name: 'Placeholder', last_name: 'Student', nickname: null, email: 'student@example.test', school_email: null,
  phone: null, date_of_birth: '2010-01-01', gender: 'female', account_invite_sent_at: null,
  age_bracket: 'high_school', event_role: 'participant', grade: 'grade_10', grade_auto_promote: true,
  graduation_year: null as number | null, tshirt_size: null, discord_handle: null, health_conditions: null,
  is_active: true, created_at: '2026-01-01T00:00:00Z',
  ec_first_name: null, ec_last_name: null, ec_email: null, ec_phone: null, ec_relationship: null,
  member_memberships: [], member_schools: [], member_ethnicities: [], member_allergies: [], event_participations: [],
  ...over,
})

const renderDetail = (over: Record<string, unknown> = {}) =>
  render(
    <AdminMemberDetail
      member={member(over) as never}
      tiers={[]} schools={[]} ethnicityOptions={[]} allergyOptions={[]} registrations={[]} sessions={[]}
      membershipId={null} activity={[]} compliance={null} agreement={null} scholarships={[]} surveys={null}
      canManageEventManager={false} viewerIsAdmin={false}
    />,
  )

const field = () => screen.queryByRole('spinbutton', { name: 'Graduation year' })
let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
})
afterEach(() => fetchSpy.mockRestore())

const patchBody = () => {
  const call = fetchSpy.mock.calls.find((args: unknown[]) => (args[1] as RequestInit | undefined)?.method === 'PATCH')
  return JSON.parse(String((call?.[1] as RequestInit).body))
}

describe('AdminMemberDetail — graduation year', () => {
  it('shows a student’s year on file and saves an edit with the profile', async () => {
    const user = userEvent.setup()
    renderDetail({ graduation_year: 2029 })
    expect(field()).toHaveValue(2029)
    await user.clear(field()!)
    await user.type(field()!, '2030')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patchBody()).toMatchObject({ graduation_year: '2030' }))
  })

  it('sends a cleared field as empty, which the route stores as NULL', async () => {
    const user = userEvent.setup()
    renderDetail({ graduation_year: 2029 })
    await user.clear(field()!)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patchBody()).toMatchObject({ graduation_year: '' }))
  })

  it('is offered for a student with none on file, and not for an adult with none', () => {
    const { unmount } = renderDetail()
    expect(field()).toHaveValue(null)
    unmount()
    renderDetail({ age_bracket: 'adult', event_role: 'teacher', grade: null })
    expect(field()).not.toBeInTheDocument()
  })

  it('stays visible for a graduate whose year is on file, so staff can correct it', () => {
    renderDetail({ age_bracket: 'adult', event_role: 'mentor', grade: null, graduation_year: 2024 })
    expect(field()).toHaveValue(2024)
  })

  it('shows the route’s reason when a save is refused', async () => {
    const user = userEvent.setup()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ error: 'Graduation year must be a year from 2027 to 2035.' }), { status: 400 }))
    renderDetail()
    await user.type(field()!, '1999')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Graduation year must be a year from 2027 to 2035.')
  })
})
