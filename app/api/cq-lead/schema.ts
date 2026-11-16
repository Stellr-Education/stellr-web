import { z } from 'zod'
import { CQ_STUDENTS_BANDS, CQ_THEMES } from '@/lib/hubspot-fields'

/**
 * The Classroom Qualifier curriculum request's teacher fields, shared by the
 * route (the validation that counts: a bot posts JSON straight at it) and
 * CurriculumLeadForm, so the caps, bands and themes cannot drift.
 * docs/REC-form-spam-hardening.md §5.
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 */

const tooLong = (n: number) => `Please keep this to ${n} characters or fewer`

export const cqLeadFields = {
  firstName: z.string().trim().min(1, 'Please enter your first name').max(100, tooLong(100)),
  lastName: z.string().trim().min(1, 'Please enter your last name').max(100, tooLong(100)),
  email: z
    .string()
    .trim()
    .email('Please enter your school email address')
    .max(254, 'Please enter your school email address'),
  school: z.string().trim().min(1, 'Please enter your school').max(200, tooLong(200)),
  subject: z.string().trim().min(1, 'Please enter your course or subject').max(200, tooLong(200)),
  studentsBand: z.enum(CQ_STUDENTS_BANDS, { error: 'Please choose a range' }),
  theme: z.enum(CQ_THEMES, { error: 'Please choose a theme' }),
  grantInterest: z.boolean(),
  consent: z.literal(true, { error: 'Please agree so we can send you the curriculum' }),
}
