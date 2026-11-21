'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import { ClipboardCheck, Shield, Sparkles } from 'lucide-react'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/**
 * The account menu. The role comes from Clerk's public metadata (the same
 * source as the session claims the server checks), so every header that shows
 * this menu gets the right links without passing roles down. `isAdmin` from the
 * server still wins when it is set, so the admin link never flickers in.
 *
 * Menu links only: every page behind them decides through lib/authz. Staff
 * (Clerk role 'staff') land on /admin like an admin, and since S5 C25 batch 4
 * open every Competitions page, so they get the Event console link too. A
 * Staff session with no second factor is refused at the page, not here.
 */
export function NavUserButton({ isAdmin: isAdminFromServer = false }: { isAdmin?: boolean }) {
  const { user } = useUser()
  const role = (user?.publicMetadata as { role?: string } | undefined)?.role
  const isAdmin = isAdminFromServer || role === 'admin'
  const isStaff = !isAdmin && role === 'staff'
  const showsAdminPanel = isAdmin || isStaff
  const showsEventConsole = role === 'event_manager' || isStaff

  return (
    <UserButton>
      <UserButton.MenuItems>
        {/* First row — entry point to the member web app, also from www */}
        <UserButton.Link label="My Stellr" labelIcon={<Sparkles size={14} />} href={`${AUTH_URL}/account`} />
        {showsAdminPanel && <UserButton.Link label="Admin panel" labelIcon={<Shield size={14} />} href="/admin" />}
        {/* Event managers run check-in on the day; this is their way in. Staff open it too. */}
        {showsEventConsole && (
          <UserButton.Link label="Event console" labelIcon={<ClipboardCheck size={14} />} href="/admin/competitions" />
        )}
      </UserButton.MenuItems>
    </UserButton>
  )
}
