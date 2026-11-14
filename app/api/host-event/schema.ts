import { z } from 'zod'

/**
 * The Host An Event form's fields, shared by the route (the validation that
 * counts: a bot posts JSON straight at it) and HostEventForm (the same caps,
 * so a person sees the limit before the server refuses it).
 * docs/REC-form-spam-hardening.md §5.
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 */

export const HOST_EVENT_LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  organization: 200,
  address: 500,
  short: 200,
  long: 5000,
} as const

const L = HOST_EVENT_LIMITS
const tooLong = (n: number) => `Please keep this to ${n.toLocaleString('en-US')} characters or fewer`

const shortAnswer = (required: string) => z.string().trim().min(1, required).max(L.short, tooLong(L.short))

export const hostEventFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(L.name, tooLong(L.name)),
  lastName: z.string().trim().min(1, 'Last name is required').max(L.name, tooLong(L.name)),
  email: z.string().trim().email('Please enter a valid email address').max(L.email, 'Please enter a valid email address'),
  phone: z.string().trim().min(1, 'Please enter a valid phone number').max(L.phone, tooLong(L.phone)),
  companySchool: z.string().trim().min(1).max(L.organization),
  address: z.string().trim().max(L.address).optional(),
  venueCapacity: shortAnswer('Please provide an approximate capacity'),
  preferredTiming: shortAnswer('Please indicate your preferred timing'),
  preferredDuration: shortAnswer('Please indicate your preferred event duration'),
  funding: z.string().trim().max(L.long, tooLong(L.long)).optional(),
  facilityOverheads: z.string().trim().max(L.long, tooLong(L.long)).optional(),
}

/**
 * For the route: a bare number is accepted as its text, as the route always
 * accepted it. The form's inputs only ever send text.
 */
export function numberAsText<T extends z.ZodType<string, string>>(field: T) {
  return z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v), field)
}
