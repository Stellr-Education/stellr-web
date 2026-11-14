import { z } from 'zod'

/**
 * The contact form's fields, shared by the route (the validation that counts:
 * a bot posts JSON straight at it) and ContactForm (the same caps and inquiry
 * types, so the two cannot drift). docs/REC-form-spam-hardening.md §5.
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 */

/** The inquiry types the form offers, in the order it offers them. */
export const CONTACT_TYPES = [
  'General',
  'Event Registration Help',
  'Sponsorship / Donation',
  'Volunteer / Mentor',
  'Media',
  'Other',
] as const

export type ContactType = (typeof CONTACT_TYPES)[number]

export function isContactType(v: string): v is ContactType {
  return (CONTACT_TYPES as readonly string[]).includes(v)
}

export const CONTACT_LIMITS = { name: 120, email: 254, type: 60, message: 5000 } as const

const L = CONTACT_LIMITS

export const contactFields = {
  name: z.string().trim().min(1, 'Please enter your name').max(L.name, `Please keep your name to ${L.name} characters or fewer`),
  email: z.string().trim().email('Please enter a valid email address').max(L.email, 'Please enter a valid email address'),
  /**
   * The route's inquiry type. Only the six types the form offers ever reach the
   * inbox: anything else (a bot's subject-line text) is filed as Other. The
   * form itself offers no way to send another value.
   */
  type: z
    .string()
    .trim()
    .min(1, 'Please select an inquiry type')
    .max(L.type, 'Please select an inquiry type')
    .transform((t): ContactType => (isContactType(t) ? t : 'Other')),
  /** The form's inquiry type: exactly one of the six. */
  typeChoice: z.enum(CONTACT_TYPES, { error: 'Please select an inquiry type' }),
  message: z
    .string()
    .trim()
    .min(1, 'Please tell us how we can help')
    .max(L.message, 'Please keep your message to 5,000 characters or fewer'),
}

/**
 * For the route: a bare number is accepted as its text, as the route always
 * accepted it. The form's inputs only ever send text.
 */
export function numberAsText<T extends z.ZodType<string, string>>(field: T) {
  return z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v), field)
}

