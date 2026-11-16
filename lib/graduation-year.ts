/**
 * graduation-year.ts
 * -----------------------------------------------------------------------------
 * members.graduation_year: the school year a student finishes high school in.
 *
 * The July-1 Alumni upgrade (app/api/cron/alumni-upgrades) reads it and nothing
 * wrote it, so the cron had no one to upgrade (docs/PLAN-former-student-mentor-
 * upgrade.md §2.1). Three writers share these rules: the onboarding wizard and
 * its route, the admin member editor, and scripts/backfill-graduation-year.ts.
 *
 * Every year here is a SCHOOL year, named for the year it ends, by the one rule
 * the rest of the codebase uses (schoolYearFor, lib/hubspot-fields.ts; August is
 * the cutover). A grade 12 student in November 2026 is in the 2027 school year
 * and graduates in 2027. Never the calendar year: that would put an autumn
 * senior's graduation a year early.
 */

import { schoolYearFor } from '@/lib/hubspot-fields'
import { normalizeGrade } from '@/lib/member-enums'

/** The furthest ahead a graduation year may be: a grade 6 student is six years out, with room to spare. */
export const GRADUATION_YEARS_AHEAD = 8

/** The school year `now` falls in (the year it ends). */
export function currentSchoolYear(now: Date = new Date()): number {
  return schoolYearFor(now)
}

/** The graduation years a member may give: this school year to eight years on, inclusive. */
export function graduationYearRange(now: Date = new Date()): { min: number; max: number } {
  const min = currentSchoolYear(now)
  return { min, max: min + GRADUATION_YEARS_AHEAD }
}

export type GraduationYearParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

/**
 * Read a submitted graduation year. Blank (undefined, null, '') is `value: null`,
 * meaning "not given". Anything else must be a whole number in
 * graduationYearRange; a number or a numeric string are both accepted, since a
 * form posts strings.
 */
export function parseGraduationYear(raw: unknown, now: Date = new Date()): GraduationYearParse {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null
  if (text === '') return { ok: true, value: null }
  const { min, max } = graduationYearRange(now)
  const error = `Graduation year must be a year from ${min} to ${max}.`
  if (text === null || !/^\d{4}$/.test(text)) return { ok: false, error }
  const year = Number(text)
  if (year < min || year > max) return { ok: false, error }
  return { ok: true, value: year }
}

/**
 * The graduation year a school grade implies, for a grade that is current on
 * `now`: grade 12 graduates this school year, grade 11 next, down to grade 6.
 * Null for a college grade, a blank, or anything that is not a grade.
 *
 * Derived years are never in the past, so a stale grade can only make the
 * Alumni upgrade late, never early.
 */
export function graduationYearFromGrade(grade: unknown, now: Date = new Date()): number | null {
  const canonical = normalizeGrade(grade)
  const m = canonical?.match(/^grade_(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  if (n < 6 || n > 12) return null
  return currentSchoolYear(now) + (12 - n)
}
