/**
 * lib/authz/shadow-sample.ts — which decisions AUTHZ_SOURCE=shadow compares.
 *
 * Owner decision, 21 Nov 2026 (docs/AUTHZ.md, "Shadow reads are sampled"):
 *   - a Clerk answer that GRANTS (admin, staff, crew, any role, scope or
 *     capability) is always compared with postgres;
 *   - a Clerk answer that DENIES is compared for a sampled share only,
 *     AUTHZ_SHADOW_DENY_SAMPLE (0 to 1), default 0.05.
 * clerk and postgres never sample: clerk makes no postgres read, and under
 * postgres the tables decide every time.
 *
 * The draw is a plain random number, never anything about the request or the
 * person, and lib/authz.ts takes one per request (cached alongside the
 * principal), so a request is sampled or not as a whole. Pure, no server-only:
 * a test injects the random source with setShadowRandom.
 */

export const AUTHZ_SHADOW_DENY_SAMPLE_ENV = 'AUTHZ_SHADOW_DENY_SAMPLE'

/** The share of Clerk denials compared under shadow when the variable is unset or invalid. */
export const DEFAULT_SHADOW_DENY_SAMPLE = 0.05

/** The share a set value gives, or null when it is not a number from 0 to 1. Blank is null. */
function parseShare(raw: string): number | null {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

/** AUTHZ_SHADOW_DENY_SAMPLE as a share from 0 to 1. Unset, blank or invalid is the default. */
export function shadowDenySample(raw: string | undefined): number {
  return raw === undefined ? DEFAULT_SHADOW_DENY_SAMPLE : parseShare(raw) ?? DEFAULT_SHADOW_DENY_SAMPLE
}

/** A set value that fell back to the default. Unset or blank is not unrecognised. */
export function isUnrecognisedShadowDenySample(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== '' && parseShare(raw) === null
}

/**
 * Does this Clerk answer grant? `true`, or a decision with `ok: true`. For
 * isCrewTarget, `true` is "the target holds a staff role", which is a role
 * granted, so it is always compared too.
 */
export function isGrant(answer: unknown): boolean {
  if (typeof answer === 'boolean') return answer
  return !!answer && typeof answer === 'object' && 'ok' in answer && (answer as { ok: unknown }).ok === true
}

/** Compare this decision under shadow? Always for a grant; for a denial when the draw (0 to <1) falls under the share. */
export function shouldShadow(clerkAnswer: unknown, draw: number, share: number): boolean {
  return isGrant(clerkAnswer) || draw < share
}

let random: () => number = Math.random

/** The random source for the per-request draw. Tests inject one; called with nothing, it goes back to Math.random. */
export function setShadowRandom(fn?: () => number): void {
  random = fn ?? Math.random
}

/** One draw from the random source, in [0, 1). */
export function shadowRandom(): number {
  return random()
}
