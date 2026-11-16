import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import type { AdminModule, AdminSection } from '@/components/admin/community/TrainingManager'
import { CourseBuilder } from './CourseBuilder'
import GatesManager from './GatesManager'
import { RemindersTab, type ReminderCourse } from './RemindersTab'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/academy/training',
  useSearchParams: () => new URLSearchParams('tab=builder'),
}))

// Building courses, prerequisites and reminder rules are academy:manage, an admin's alone (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const section = (id: string, title: string, display_order: number): AdminSection => ({ id, title, display_order, drip_days: 0 })
const course: AdminModule = {
  id: 'course-1',
  title: 'Orbital mechanics',
  description: null,
  material_kind: 'general',
  course_type: 'self_paced',
  theme: 'space',
  cert_template_path: null,
  credential_title: null,
  credential_description: null,
  credential_criteria: null,
  credential_skills: [],
  start_date: null,
  event_ref: null,
  min_tier_rank: 0,
  is_published: true,
  training_sections: [section('s-a', 'Alpha', 0), section('s-b', 'Beta', 1)],
  training_items: [],
  course_object_assignments: [],
}
const builder = <CourseBuilder courses={[course]} objects={[]} tiers={[]} />

const reminders: ReminderCourse[] = [{
  id: 'course-1',
  title: 'Orbital mechanics',
  settings: { remind_inapp: true, remind_email: true, remind_sms: false, remind_2wk: false, remind_1wk: true, remind_2d: false, remind_1d: true, escalate_supervisor: true },
}]
const gates = <GatesManager modules={[{ id: 'course-1', title: 'Orbital mechanics' }, { id: 'course-2', title: 'Launch basics' }]} prereqs={[{ id: 'p-1', target_ref: 'course-1', requires_target_ref: 'course-2' }]} persistence={{}} />

let writes: string[] = []
beforeEach(() => {
  writes = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') writes.push(`${init.method} ${url}`)
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Training — admin', () => {
  it('builds a course', () => {
    asAdmin(builder)
    expect(screen.getByRole('button', { name: 'Move Alpha down' })).toBeEnabled()
    expect(screen.queryByText('An admin builds and edits courses. You can see each course here.')).toBeNull()
  })
  it('sets reminder rules and prerequisites', () => {
    asAdmin(<>{<RemindersTab courses={reminders} />}{gates}</>)
    expect(screen.getByRole('switch', { name: 'Email' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove prerequisite' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'Add a prerequisite for Orbital mechanics' })).toBeEnabled()
  })
})

describe('Training — Staff', () => {
  it('picks a course and sees it: no reorder, every other builder control disabled', () => {
    asStaff(builder)
    expect(screen.getByText('An admin builds and edits courses. You can see each course here.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Editing' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Move Alpha down' })).toBeNull()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })
  it('cannot save a reorder by dragging either', () => {
    asStaff(builder)
    const handle = screen.getByText('Alpha').closest('[draggable]')
    expect(handle).toHaveAttribute('draggable', 'false')
    if (handle) { fireEvent.dragStart(handle); fireEvent.drop(handle) }
    expect(writes).toEqual([])
  })
  it('sees reminder rules and prerequisites read-only', () => {
    asStaff(<>{<RemindersTab courses={reminders} />}{gates}</>)
    expect(screen.getByRole('combobox', { name: 'Settings for course' })).toBeEnabled()
    expect(screen.getByRole('switch', { name: 'Email' })).toBeDisabled()
    expect(screen.getByText('An admin changes these rules.')).toBeInTheDocument()
    expect(screen.getByText('Launch basics', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove prerequisite' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Add a prerequisite for Orbital mechanics' })).toBeDisabled()
    expect(screen.getByText('An admin sets prerequisites and archive behaviour.')).toBeInTheDocument()
  })
})
