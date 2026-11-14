import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CapabilitiesProvider } from '@/components/admin/CapabilitiesContext'
import { CAPABILITIES, STAFF_CAPABILITIES } from '@/lib/authz/capabilities'
import { DEFAULT_PROVIDER_STATE } from '@/lib/esign/routing'
import type { EngineSummary } from '@/lib/esign/state'
import { EsignEngineCard } from './EsignEngineCard'

// The engine settings and maintenance are esign:manage, an admin's alone; reading
// the summary is portal:read (staff-role.9).
const asAdmin = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={CAPABILITIES}>{ui}</CapabilitiesProvider>)
const asStaff = (ui: ReactElement) => render(<CapabilitiesProvider capabilities={STAFF_CAPABILITIES}>{ui}</CapabilitiesProvider>)

const summary: EngineSummary = {
  state: { ...DEFAULT_PROVIDER_STATE, mode: 'auto' },
  nativeAvailable: true,
  periodStart: '2026-11-01T00:00:00Z',
  issuedThisPeriod: 3,
  estimatedUsed: 3,
  usableAllowance: 38,
  currentEngine: 'docusign',
  archive: { unarchived: 0, failing: 0 },
  storage: { documents: 10, bytes: 1024 ** 2, limitBytes: 1024 ** 3, warn: false },
  restricted: 0,
  lastRuns: [],
  backup: { configured: true, unreplicated: 0 },
  outbox: { waiting: 0, dailyBudget: 50 },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })))
})
afterEach(() => vi.unstubAllGlobals())

describe('E-signature engine card', () => {
  it('admin: switches the engine and runs the checks', async () => {
    asAdmin(<EsignEngineCard />)
    const auto = await screen.findByRole('radio', { name: 'DocuSign, then Stellr when the allowance runs out', hidden: true })
    expect(auto).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Store signed documents now', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send it to the next 25', hidden: true })).toBeInTheDocument()
  })
  it('Staff: reads the summary, with the switch disabled and no maintenance buttons', async () => {
    asStaff(<EsignEngineCard />)
    const auto = await screen.findByRole('radio', { name: 'DocuSign, then Stellr when the allowance runs out', hidden: true })
    expect(auto).toBeDisabled()
    expect(auto).toBeChecked()
    for (const c of screen.getAllByRole('checkbox', { hidden: true })) expect(c).toBeDisabled()
    for (const name of ['Check for unstored documents', 'Store signed documents now', 'Members without a membership agreement', 'Send it to the next 25']) {
      expect(screen.queryByRole('button', { name, hidden: true })).toBeNull()
    }
    expect(screen.getByText('An admin changes where agreements go and runs these checks.')).toBeInTheDocument()
  })
})
