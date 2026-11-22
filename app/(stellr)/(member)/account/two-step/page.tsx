import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { UserProfile } from '@clerk/nextjs'
import { Button } from '@stellr/web-ui'

export const metadata = { title: 'Turn on two-step verification' }

// F4 part B (lib/authz/admin-mfa.ts): with ADMIN_MFA_ENFORCE on, an admin whose
// session has no second factor is sent here from the admin portal. The security
// settings below are Clerk's; two-step options appear only once MFA is enabled
// on the Clerk instance (Clerk Pro).
export default async function TwoStepPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-ds-h2 font-bold text-ink">Turn on two-step verification</h1>
        <p className="max-w-prose text-content-body">
          The admin portal holds students’ personal details, so it needs a second step at sign-in. Under Security,
          add an authenticator app, then sign out and back in to use it.
        </p>
      </div>
      <UserProfile routing="hash" />
      <Button href="/admin" as={Link} variant="secondary">
        Back to the admin portal
      </Button>
    </div>
  )
}
