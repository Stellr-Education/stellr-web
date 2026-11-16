import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Registration identity hardening: a closed (deactivated) account that signs in
// gets one clear end state, never the profile form, and the page writes nothing.

const h = vi.hoisted(() => ({
  closed: false,
  viewAs: null as string | null,
  writes: [] as string[],
  readPendingConsent: vi.fn(async () => ({ state: 'none' })),
  settlePendingConsent: vi.fn(async () => true),
  memberAccountClosed: vi.fn(async () => false),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_placeholder' }),
  currentUser: async () => ({
    primaryEmailAddressId: 'e1',
    emailAddresses: [{ id: 'e1', emailAddress: 'Closed@Example.test' }],
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`redirect:${to}`) }),
}))
vi.mock('@/lib/impersonation', () => ({ impersonatedMemberId: async () => h.viewAs }))
vi.mock('./account-closed', () => ({ memberAccountClosed: h.memberAccountClosed }))
vi.mock('@/lib/pending-consent', () => ({
  minorSelfSignupEnabled: () => false,
  readPendingConsent: h.readPendingConsent,
  settlePendingConsent: h.settlePendingConsent,
}))
vi.mock('@/components/member/OnboardingForm', () => ({
  OnboardingForm: () => <form aria-label="onboarding form" />,
  PendingConsentPanel: () => <div>pending</div>,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        update: () => { h.writes.push('update'); return chain },
        insert: () => { h.writes.push('insert'); return chain },
        upsert: () => { h.writes.push('upsert'); return chain },
        delete: () => { h.writes.push('delete'); return chain },
      }
      return chain
    },
  }),
}))

const { default: OnboardingPage } = await import('./page')

const open = async (searchParams: Record<string, string> = {}) =>
  render(await OnboardingPage({ searchParams: Promise.resolve(searchParams) }))

beforeEach(() => {
  h.viewAs = null
  h.writes.length = 0
  h.readPendingConsent.mockClear()
  h.settlePendingConsent.mockClear()
  h.memberAccountClosed.mockReset()
  h.memberAccountClosed.mockResolvedValue(false)
})

describe('onboarding page for a closed account', () => {
  it('shows the closed-account answer, not the form, and writes nothing', async () => {
    h.memberAccountClosed.mockResolvedValue(true)
    await open({ next: '/home' })
    expect(screen.getByRole('heading', { name: 'This account is closed' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Contact Stellr' }).getAttribute('href')).toBe('/contact')
    expect(screen.queryByRole('form', { name: 'onboarding form' })).toBeNull()
    expect(h.memberAccountClosed).toHaveBeenCalledWith(expect.anything(), 'user_placeholder', 'closed@example.test')
    expect(h.readPendingConsent).not.toHaveBeenCalled()
    expect(h.settlePendingConsent).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
  })

  it('shows the form as before for an open account with no profile yet', async () => {
    await open()
    expect(screen.getByRole('form', { name: 'onboarding form' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'This account is closed' })).toBeNull()
  })

  it('does not ask while an admin is viewing as a member', async () => {
    h.viewAs = 'm-viewed'
    h.memberAccountClosed.mockResolvedValue(true)
    await open()
    expect(h.memberAccountClosed).not.toHaveBeenCalled()
  })
})
