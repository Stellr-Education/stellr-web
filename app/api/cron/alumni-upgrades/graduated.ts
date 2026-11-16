/**
 * When a member counts as graduated, for the Alumni upgrade.
 *
 * One rule, shared by the alumni-upgrades cron and
 * scripts/backfill-graduation-year.ts: the school-year rollover the rest of the
 * codebase uses (currentSchoolYear, lib/graduation-year.ts, over schoolYearFor
 * in lib/hubspot-fields.ts; August is the cutover). members.graduation_year is a
 * school year, named for the year it ends, so a member has graduated once the
 * current school year is later than theirs.
 *
 * Why not 1 July: between 1 July and the August rollover the current school
 * year is still the one just ending, and a grade on file (or a year derived from
 * it) may already describe the year ahead. A rising senior who gave grade 12 in
 * July gets this school year as a graduation year; a cron firing from 1 July
 * then upgraded them to Alumni a year early (backlog-batch2.10 review note).
 * The upgrade for each cohort now runs from 1 August.
 */

import { currentSchoolYear } from '@/lib/graduation-year'

/** True when a member with this graduation year has finished school on `now`. */
export function hasGraduated(graduationYear: number, now: Date = new Date()): boolean {
  return graduationYear < currentSchoolYear(now)
}

/** The latest graduation year that has graduated on `now`: the cron's query bound. */
export function latestGraduatedYear(now: Date = new Date()): number {
  return currentSchoolYear(now) - 1
}

/**
 * True from 1 July until the school year rolls over: the calendar has reached
 * the next school year's summer, but the school year has not changed yet. A
 * grade read in this window is ambiguous (last year's or next year's), so the
 * backfill refuses to write then.
 */
export function inRolloverGap(now: Date = new Date()): boolean {
  return now.getUTCMonth() >= 6 && currentSchoolYear(now) === now.getUTCFullYear()
}
