/**
 * In-app Classroom Qualifier upgrade prompts (handover Phase 2): after the
 * teacher gets started, at the week-2 check-in, and in the two weeks before
 * the deadline. The same cadence as the HubSpot follow-up sequence
 * (docs/classroom-qualifier/HUBSPOT-SEQUENCES.md), so the app and the inbox
 * say the same thing at the same time.
 *
 * Pure: the caller decides who sees it (free Educator tier only) and passes
 * the dates. All dates are ISO; "today" is a YYYY-MM-DD string.
 */

export type CqUpgradeStage = 'started' | 'week2' | 'deadline'

const DAY_MS = 86_400_000

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / DAY_MS)
}

export function cqUpgradeStage({
  registeredAt,
  deadline,
  submitted,
  today = new Date().toISOString().slice(0, 10),
}: {
  registeredAt?: string | null
  deadline?: string | null
  submitted?: boolean
  today?: string
}): CqUpgradeStage | null {
  if (submitted) return null
  if (deadline) {
    const left = daysBetween(today, deadline)
    if (left < 0) return null
    if (left <= 14) return 'deadline'
  }
  if (!registeredAt) return null
  const since = daysBetween(registeredAt, today)
  if (since < 0) return null
  if (since < 7) return 'started'
  if (since < 14) return 'week2'
  return null
}

/** Copy for each stage. Catalyst is named by what it adds (tier-data role). */
export function cqUpgradeCopy(stage: CqUpgradeStage, deadlineLabel?: string | null): { heading: string; body: string } {
  switch (stage) {
    case 'started':
      return {
        heading: 'Your curriculum is ready',
        body: 'Catalyst adds the full material and PD hours, so you can teach it with less prep.',
      }
    case 'week2':
      return {
        heading: 'Week 2 check-in',
        body: 'How is your team getting on? Catalyst adds the full material and PD hours for the weeks ahead.',
      }
    case 'deadline':
      return {
        heading: deadlineLabel ? `Two weeks to go: proposals due ${deadlineLabel}` : 'Two weeks to the deadline',
        body: 'Catalyst adds the full material and PD hours to help your team finish strong.',
      }
  }
}
