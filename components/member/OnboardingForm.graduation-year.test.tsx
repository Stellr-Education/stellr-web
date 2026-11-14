import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingForm } from './OnboardingForm'
import { graduationYearRange } from '@/lib/graduation-year'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

// alumni.mentor-upgrade: the July-1 Alumni upgrade reads members.graduation_year,
// so the wizard asks school students for it. Optional, and never asked of adults.
const field = () => screen.queryByRole('spinbutton', { name: /Expected graduation year/ })

async function toDetails(role: string) {
  const user = userEvent.setup()
  render(<OnboardingForm existingMember={null} />)
  await user.click(screen.getByRole('button', { name: role }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  return user
}

describe('OnboardingForm — expected graduation year', () => {
  it('asks a high-school student, labelled optional, within this school year to eight years on', async () => {
    await toDetails('Student (High School)')
    const input = field()
    expect(input).toBeInTheDocument()
    expect(screen.getByText('(optional)', { selector: 'label span' })).toBeInTheDocument()
    const { min, max } = graduationYearRange()
    expect(input).toHaveAttribute('min', String(min))
    expect(input).toHaveAttribute('max', String(max))
    expect(input).not.toBeRequired()
    expect(input).toHaveAccessibleDescription('The year you finish high school.')
  })

  it('asks a student manager too: they are school students', async () => {
    await toDetails('Student Manager (leads a group)')
    expect(field()).toBeInTheDocument()
  })

  it.each(['Teacher / Educator', 'Parent / Guardian', 'Mentor / Volunteer'])('does not ask an adult (%s)', async (role) => {
    await toDetails(role)
    expect(screen.getByRole('textbox', { name: 'Phone' })).toBeInTheDocument()
    expect(field()).not.toBeInTheDocument()
  })

  it('appears for anyone whose date of birth says under 18, since they are saved as a high-school student', async () => {
    const user = await toDetails('Parent / Guardian')
    expect(field()).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Date of birth'), `${new Date().getFullYear() - 15}-01-01`)
    expect(field()).toBeInTheDocument()
  })

  it('does not ask on the volunteer sign-up', async () => {
    const user = userEvent.setup()
    render(<OnboardingForm existingMember={null} volunteerFlow />)
    await user.click(screen.getByRole('button', { name: 'College / university student' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(field()).not.toBeInTheDocument()
  })

  it('a year outside the range stops the step with the range under the field; blank does not', async () => {
    const user = await toDetails('Student (High School)')
    const { min, max } = graduationYearRange()
    await user.click(screen.getByRole('button', { name: /Continue|Complete profile/ }))
    expect(field()).not.toHaveAttribute('aria-invalid')

    await user.type(field()!, String(max + 1))
    await user.click(screen.getByRole('button', { name: /Continue|Complete profile/ }))
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(field()).toHaveAccessibleDescription(`The year you finish high school. Enter a year from ${min} to ${max}.`)

    await user.clear(field()!)
    await user.type(field()!, String(min))
    expect(field()).not.toHaveAttribute('aria-invalid')
  })
})
