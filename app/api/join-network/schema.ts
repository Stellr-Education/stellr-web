import { z } from 'zod'

/**
 * The Join The Network form's fields, shared by the route (the validation that
 * counts: a bot posts JSON straight at it) and JoinNetworkForm (the same caps
 * and partner types, so the two cannot drift).
 * docs/REC-form-spam-hardening.md §5.
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 */

/** The partner types the form offers. */
export const PARTNER_TYPES = [
  'Fellow Education Provider [Industry]',
  'Interested College [University]',
  'Want To Support [Corporate]',
] as const

export const JOIN_NETWORK_LIMITS = {
  name: 120,
  email: 254,
  phone: 40,
  company: 200,
  address: 500,
  whatYouDo: 5000,
  reason: 120,
} as const

const L = JOIN_NETWORK_LIMITS
const tooLong = (n: number) => `Please keep this to ${n.toLocaleString('en-US')} characters or fewer`

export const joinNetworkFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(L.name, tooLong(L.name)),
  lastName: z.string().trim().min(1, 'Last name is required').max(L.name, tooLong(L.name)),
  email: z.string().trim().email('Please enter a valid email address').max(L.email, 'Please enter a valid email address'),
  phone: z.string().trim().min(1, 'Please enter a valid phone number').max(L.phone, tooLong(L.phone)),
  companyName: z.string().trim().min(1, 'Company name is required').max(L.company, tooLong(L.company)),
  address: z.string().trim().max(L.address, tooLong(L.address)).optional(),
  whatYouDo: z
    .string()
    .trim()
    .min(1, 'Please tell us a little about what you do')
    .max(L.whatYouDo, tooLong(L.whatYouDo)),
  /** The route's partner type: capped text (the email escapes it). */
  reason: z.string().trim().min(1, 'Please choose an option').max(L.reason, 'Please choose an option'),
  /** The form's partner type: exactly one of the three. */
  reasonChoice: z.enum(PARTNER_TYPES, { error: 'Please choose an option' }),
}
