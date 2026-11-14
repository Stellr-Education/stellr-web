import { z } from 'zod'

/**
 * The scholarship application's fields, shared by the route (the validation
 * that counts: a bot posts JSON straight at it) and ScholarshipForm (the same
 * caps, so a person sees the limit before the server refuses it).
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 *
 * Length caps keep a pasted essay (or a bot) from filling the table and the
 * staff inbox; they sit well above anything a real application has used.
 */

export const SCHOLARSHIP_LIMITS = {
  name: 100,
  email: 254,
  phone: 40,
  activity: 200,
  school: 200,
  brief: 5000,
} as const

const L = SCHOLARSHIP_LIMITS
const tooLong = (n: number) => `Please keep this to ${n.toLocaleString('en-US')} characters or fewer`

export const scholarshipFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(L.name, tooLong(L.name)),
  lastName: z.string().trim().min(1, 'Last name is required').max(L.name, tooLong(L.name)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Please enter a valid email address')
    .max(L.email, 'Please enter a valid email address'),
  phone: z.string().trim().max(L.phone, tooLong(L.phone)).optional().or(z.literal('')),
  activity: z.string().trim().min(1, 'Please choose a Stellr activity').max(L.activity, tooLong(L.activity)),
  school: z.string().trim().max(L.school, tooLong(L.school)).optional().or(z.literal('')),
  brief: z
    .string()
    .trim()
    .min(1, 'Please tell us a little about your application')
    .max(L.brief, tooLong(L.brief)),
}
