import { describe, expect, it } from 'vitest'
import {
  GRADUATION_YEARS_AHEAD,
  currentSchoolYear,
  graduationYearFromGrade,
  graduationYearRange,
  parseGraduationYear,
} from './graduation-year'
import { schoolYearFor } from './hubspot-fields'

// November 2026 is in the 2027 school year (August cutover).
const NOV_2026 = new Date(Date.UTC(2026, 10, 14))
const JULY_31_2027 = new Date(Date.UTC(2027, 6, 31, 23, 59, 59))
const AUG_1_2027 = new Date(Date.UTC(2027, 7, 1, 0, 0, 0))

describe('currentSchoolYear', () => {
  it('is the shared school-year rule, not the calendar year', () => {
    expect(currentSchoolYear(NOV_2026)).toBe(2027)
    expect(currentSchoolYear(NOV_2026)).toBe(schoolYearFor(NOV_2026))
  })

  it('rolls over at August: July still belongs to the year that just ended', () => {
    expect(currentSchoolYear(JULY_31_2027)).toBe(2027)
    expect(currentSchoolYear(AUG_1_2027)).toBe(2028)
  })
})

describe('graduationYearFromGrade', () => {
  it.each([
    ['grade_12', 2027],
    ['grade_11', 2028],
    ['grade_10', 2029],
    ['grade_9', 2030],
    ['grade_8', 2031],
    ['grade_7', 2032],
    ['grade_6', 2033],
  ])('%s in November 2026 graduates in %i', (grade, year) => {
    expect(graduationYearFromGrade(grade, NOV_2026)).toBe(year)
  })

  it('reads the legacy bare-number spelling the same as the enum value', () => {
    expect(graduationYearFromGrade('10', NOV_2026)).toBe(2029)
    expect(graduationYearFromGrade('Grade 10', NOV_2026)).toBe(2029)
  })

  it('a grade 12 student on 31 July still graduates that year; from 1 August a grade 12 graduates the next', () => {
    expect(graduationYearFromGrade('grade_12', JULY_31_2027)).toBe(2027)
    expect(graduationYearFromGrade('grade_12', AUG_1_2027)).toBe(2028)
    expect(graduationYearFromGrade('grade_9', JULY_31_2027)).toBe(2030)
    expect(graduationYearFromGrade('grade_9', AUG_1_2027)).toBe(2031)
  })

  it('is null for college grades, blanks and anything that is not a grade', () => {
    for (const g of ['college_freshman', 'college_senior', 'grad_phd', '', null, undefined, 'grade_13', 'banana', 5]) {
      expect(graduationYearFromGrade(g, NOV_2026)).toBeNull()
    }
  })

  it('every derived year is inside the range a member may give', () => {
    const { min, max } = graduationYearRange(NOV_2026)
    for (let n = 6; n <= 12; n++) {
      const y = graduationYearFromGrade(`grade_${n}`, NOV_2026)!
      expect(y).toBeGreaterThanOrEqual(min)
      expect(y).toBeLessThanOrEqual(max)
    }
  })
})

describe('graduationYearRange', () => {
  it('runs from this school year to eight years on', () => {
    expect(graduationYearRange(NOV_2026)).toEqual({ min: 2027, max: 2027 + GRADUATION_YEARS_AHEAD })
    expect(graduationYearRange(AUG_1_2027).min).toBe(2028)
  })
})

describe('parseGraduationYear', () => {
  it('treats blank as not given', () => {
    for (const v of [undefined, null, '', '   ']) expect(parseGraduationYear(v, NOV_2026)).toEqual({ ok: true, value: null })
  })

  it('accepts a number or a numeric string inside the range, ends included', () => {
    expect(parseGraduationYear(2027, NOV_2026)).toEqual({ ok: true, value: 2027 })
    expect(parseGraduationYear('2035', NOV_2026)).toEqual({ ok: true, value: 2035 })
    expect(parseGraduationYear(' 2030 ', NOV_2026)).toEqual({ ok: true, value: 2030 })
  })

  it('refuses a year outside the range, with the range in the message', () => {
    for (const v of [2026, '2036', 1999]) {
      const r = parseGraduationYear(v, NOV_2026)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('Graduation year must be a year from 2027 to 2035.')
    }
  })

  it('refuses anything that is not a whole four-digit year', () => {
    for (const v of [2030.5, '2030.0', '20x0', 'next year', true, {}, [2030], -2030]) {
      expect(parseGraduationYear(v, NOV_2026).ok).toBe(false)
    }
  })
})
