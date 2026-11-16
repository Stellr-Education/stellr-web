import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Is this login's member account closed (deactivated)? Read the way
 * onboarding's POST reads it (deep review MEM-3): by Clerk id, else by the
 * login's verified primary email, because a deactivation clears the row's
 * clerk_user_id and only the email still finds it.
 *
 * The onboarding page asks this before it shows the form or writes anything: a
 * closed account would otherwise be shown "Complete your profile", have every
 * submit refused, and come back to the form after the next sign-in. Read-only.
 * A failed read is "not closed": the page then behaves as before, and the POST
 * still refuses a closed account on its own read.
 */
export async function memberAccountClosed(
  db: SupabaseClient,
  clerkUserId: string,
  primaryEmail: string | null | undefined,
): Promise<boolean> {
  const { data: byClerk } = await db
    .from('members')
    .select('id, is_active')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  if (byClerk) return (byClerk as { is_active: boolean | null }).is_active === false
  if (!primaryEmail) return false
  const { data: byEmail } = await db
    .from('members')
    .select('id, is_active')
    .eq('email', primaryEmail)
    .maybeSingle()
  return (byEmail as { is_active: boolean | null } | null)?.is_active === false
}
