import { describe, expect, it } from 'vitest'
import { cqUpgradeCopy, cqUpgradeStage } from './cq-upgrade-prompt'

describe('cqUpgradeStage', () => {
  const deadline = '2027-01-31'

  it('prompts in the first week after registering', () => {
    expect(cqUpgradeStage({ registeredAt: '2026-11-20T15:00:00Z', deadline, today: '2026-11-20' })).toBe('started')
    expect(cqUpgradeStage({ registeredAt: '2026-11-20T15:00:00Z', deadline, today: '2026-11-26' })).toBe('started')
  })

  it('gives the week-2 check-in on days 7–13', () => {
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2026-11-27' })).toBe('week2')
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2026-12-03' })).toBe('week2')
  })

  it('stays quiet between week 2 and the last two weeks', () => {
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2026-12-10' })).toBeNull()
  })

  it('prompts in the two weeks before the deadline, which outranks the others', () => {
    expect(cqUpgradeStage({ registeredAt: '2027-01-20', deadline, today: '2027-01-20' })).toBe('deadline')
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2027-01-17' })).toBe('deadline')
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2027-01-31' })).toBe('deadline')
  })

  it('stops once the proposal is in or the deadline has passed', () => {
    expect(cqUpgradeStage({ registeredAt: '2027-01-20', deadline, today: '2027-01-25', submitted: true })).toBeNull()
    expect(cqUpgradeStage({ registeredAt: '2026-11-20', deadline, today: '2027-02-01' })).toBeNull()
  })

  it('needs a registration date for the early stages', () => {
    expect(cqUpgradeStage({ deadline, today: '2026-11-20' })).toBeNull()
  })
})

describe('cqUpgradeCopy', () => {
  it('carries the deadline and never says campaign', () => {
    const c = cqUpgradeCopy('deadline', '1/31/27')
    expect(c.heading).toContain('1/31/27')
    for (const s of ['started', 'week2', 'deadline'] as const) {
      expect(JSON.stringify(cqUpgradeCopy(s, '1/31/27'))).not.toMatch(/campaign/i)
    }
  })
})
