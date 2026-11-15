// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/admin/members/[id] — graduation_year (alumni.mentor-upgrade).
// Staff can set and clear the year the July-1 Alumni upgrade reads; a new value
// gets the onboarding range check, an unchanged one is saved as it was.

const MEMBER = '11111111-1111-4111-8111-111111111111'

const { state } = vi.hoisted(() => ({
  state: {
    before: null as Record<string, unknown> | null,
    updates: [] as Record<string, unknown>[],
    logs: [] as Record<string, unknown>[],
  },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/authz', () => ({ hasCapability: async () => true }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: async () => {} }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorMemberId: null, actorLabel: 'admin' }),
  logActivity: async (entry: Record<string, unknown>) => { state.logs.push(entry) },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      let update: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        delete: () => chain,
        insert: async () => ({ error: null }),
        update: (u: Record<string, unknown>) => { update = u; return chain },
        maybeSingle: async () => ({ data: table === 'members' ? state.before : null, error: null }),
        single: async () => {
          if (table !== 'members' || !update) throw new Error(`unexpected single() on ${table}`)
          state.updates.push(update)
          return { data: { id: MEMBER, ...state.before, ...update }, error: null }
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f),
      }
      return chain
    },
  }),
}))

const { PATCH } = await import('./route')
const { graduationYearRange } = await import('@/lib/graduation-year')
const { min, max } = graduationYearRange()

const save = (body: Record<string, unknown>) =>
  PATCH(
    new Request(`https://app.test/api/admin/members/${MEMBER}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: MEMBER }) },
  )

// What the admin profile form submits for a high-school student.
const studentForm = (graduation_year: string | number) => ({
  first_name: 'Placeholder', last_name: 'Student', email: 'student@example.test', school_email: '', phone: '',
  age_bracket: 'high_school', event_role: 'participant', grade: 'grade_10', grade_auto_promote: true,
  graduation_year, tshirt_size: '', discord_handle: '', health_conditions: '',
  ec_first_name: '', ec_last_name: '', ec_email: '', ec_phone: '', ec_relationship: '',
})

beforeEach(() => {
  state.before = {
    first_name: 'Placeholder', last_name: 'Student', email: 'student@example.test', age_bracket: 'high_school',
    event_role: 'participant', grade: 'grade_10', grade_auto_promote: true, graduation_year: null,
  }
  state.updates = []
  state.logs = []
})

describe('PATCH /api/admin/members/[id] — graduation year', () => {
  it('stores a year the form sends as a string, as a number, and logs the change', async () => {
    const res = await save(studentForm(String(min + 2)))
    expect(res.status).toBe(200)
    expect(state.updates[0].graduation_year).toBe(min + 2)
    expect(state.logs[0]).toMatchObject({ action: 'profile_updated', metadata: { fields: ['graduation_year'] } })
    expect(state.logs[0].summary).toBe('Updated profile (graduation year)')
  })

  it('clears it: an empty field is stored as NULL', async () => {
    state.before!.graduation_year = min + 1
    const res = await save(studentForm(''))
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('graduation_year', null)
    expect(state.logs[0]).toMatchObject({ metadata: { fields: ['graduation_year'] } })
  })

  it.each([
    ['before this school year', () => min - 1],
    ['past the eight-year window', () => max + 1],
    ['not a year', () => 'next year'],
  ])('refuses a new year %s with a 400, before writing', async (_label, value) => {
    const res = await save(studentForm(value()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: `Graduation year must be a year from ${min} to ${max}.` })
    expect(state.updates).toEqual([])
  })

  it('an unchanged year on file saves as it was, even one now in the past (a graduate)', async () => {
    state.before!.graduation_year = min - 3
    const res = await save({ ...studentForm(String(min - 3)), first_name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(state.updates[0].graduation_year).toBe(min - 3)
    expect(state.logs[0]).toMatchObject({ metadata: { fields: ['first_name'] } })
  })

  it('a save that does not send the field leaves it alone', async () => {
    const res = await save({ first_name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(state.updates[0]).not.toHaveProperty('graduation_year')
  })
})
