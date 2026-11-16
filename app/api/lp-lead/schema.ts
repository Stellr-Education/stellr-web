import { z } from 'zod'

/**
 * The audience landing page lead's person fields, shared by the route (the
 * validation that counts: a bot posts JSON straight at it) and LeadForm, so the
 * caps cannot drift. docs/REC-form-spam-hardening.md §5.
 *
 * Fields, not a z.object: the route declares its own z.object({ … }) from
 * these, because the IDOR suite (lib/security/route-ast.ts) reads a route's
 * body keys from the z.object literal in the route file itself.
 */

export const LP_ROLES = ['teacher', 'parent', 'student'] as const

export const lpLeadFields = {
  name: z.string().min(1, 'Please tell us your name').max(200, 'Please keep your name to 200 characters or fewer'),
  email: z.string().email('Please enter a valid email address').max(254, 'Please enter a valid email address'),
  role: z.enum(LP_ROLES),
}
