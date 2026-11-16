// @vitest-environment node
//
// backlog-batch2.10 follow-up: "graduated" follows the August school-year
// rollover, not 1 July. Boundaries: 30 June, 1 / 15 / 31 July, 1 August.
import { describe, expect, it } from 'vitest'
import { hasGraduated, inRolloverGap, latestGraduatedYear } from './graduated'
import { currentSchoolYear } from '@/lib/graduation-year'

const JUN_30 = new Date(Date.UTC(2027, 5, 30, 23, 59))
const JUL_1 = new Date(Date.UTC(2027, 6, 1))
const JUL_15 = new Date(Date.UTC(2027, 6, 15))
const JUL_31 = new Date(Date.UTC(2027, 6, 31, 23, 59))
const AUG_1 = new Date(Date.UTC(2027, 7, 1))

describe('hasGraduated', () => {
  it('on 30 June the class of 2027 has not graduated yet; 2026 has', () => {
    expect(hasGraduated(2027, JUN_30)).toBe(false)
    expect(hasGraduated(2026, JUN_30)).toBe(true)
  })

  it('in July nobody new graduates: a rising senior given 2027 waits for August', () => {
    for (const day of [JUL_1, JUL_15, JUL_31]) {
      expect(hasGraduated(2027, day)).toBe(false)
      expect(hasGraduated(2028, day)).toBe(false)
      expect(hasGraduated(2026, day)).toBe(true)
    }
  })

  it('on 1 August the class of 2027 has graduated; 2028 has not', () => {
    expect(hasGraduated(2027, AUG_1)).toBe(true)
    expect(hasGraduated(2028, AUG_1)).toBe(false)
  })

  it('uses the same rollover as the graduation-year writers', () => {
    for (const day of [JUN_30, JUL_15, AUG_1]) {
      expect(hasGraduated(currentSchoolYear(day), day)).toBe(false)
      expect(hasGraduated(currentSchoolYear(day) - 1, day)).toBe(true)
    }
  })
})

describe('latestGraduatedYear', () => {
  it('is the year before the current school year', () => {
    expect(latestGraduatedYear(JUN_30)).toBe(2026)
    expect(latestGraduatedYear(JUL_15)).toBe(2026)
    expect(latestGraduatedYear(AUG_1)).toBe(2027)
  })
})

describe('inRolloverGap', () => {
  it('is true from 1 July until the August rollover only', () => {
    expect(inRolloverGap(JUN_30)).toBe(false)
    expect(inRolloverGap(JUL_1)).toBe(true)
    expect(inRolloverGap(JUL_15)).toBe(true)
    expect(inRolloverGap(JUL_31)).toBe(true)
    expect(inRolloverGap(AUG_1)).toBe(false)
    expect(inRolloverGap(new Date(Date.UTC(2027, 0, 15)))).toBe(false)
    expect(inRolloverGap(new Date(Date.UTC(2026, 11, 31)))).toBe(false)
  })
})
