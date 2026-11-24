import { describe, expect, it } from 'vitest'
import { assess, MIN_REACHED, pct } from './reputation'

const row = (reached: number, hard: number, complaints: number) => ({ tenant_id: 't', reached, hard_bounces: hard, complaints })

describe('assess', () => {
  it('says nothing below the minimum reached, whatever the rates', () => {
    expect(assess(row(MIN_REACHED - 1, 50, 50)).concerns).toEqual([])
  })
  it('flags complaints at 0.1% and hard bounces at 4%', () => {
    expect(assess(row(1000, 39, 0)).concerns).toEqual([])
    expect(assess(row(1000, 40, 0)).concerns).toEqual(['hard_bounces'])
    expect(assess(row(1000, 0, 1)).concerns).toEqual(['complaints'])
    expect(assess(row(1000, 50, 2)).concerns).toEqual(['complaints', 'hard_bounces'])
  })
  it('copes with nothing reached', () => {
    expect(assess(row(0, 0, 0))).toMatchObject({ hardBounceRate: 0, complaintRate: 0, concerns: [] })
  })
  it('formats small rates with two decimals', () => {
    expect(pct(0.001)).toBe('0.10%')
    expect(pct(0.045)).toBe('4.5%')
  })
})
