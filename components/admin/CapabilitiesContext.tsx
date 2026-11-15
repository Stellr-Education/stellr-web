'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Capability } from '@/lib/authz/capabilities'

// What the viewer may change in the admin portal, for hiding controls the API
// would refuse (staff-role.9). The admin layout computes the set once on the
// server (lib/authz currentCapabilities) and hands it down here.
//
// This only hides. Every route still decides for itself; nothing here is a guard.
// Deny by default: with no provider above it, a component holds no capability
// and shows the read-only view.

const NONE: ReadonlySet<Capability> = new Set()
const CapabilitiesContext = createContext<ReadonlySet<Capability>>(NONE)

export function CapabilitiesProvider({ capabilities, children }: { capabilities: readonly Capability[]; children: ReactNode }) {
  const value = useMemo(() => new Set(capabilities), [capabilities])
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>
}

/** May the viewer use `cap`? False outside a provider. */
export function useCan(cap: Capability): boolean {
  return useContext(CapabilitiesContext).has(cap)
}

/** For server pages: renders `children` only when the viewer holds `cap`, otherwise `fallback`. */
export function Can({ cap, children, fallback = null }: { cap: Capability; children: ReactNode; fallback?: ReactNode }) {
  return <>{useCan(cap) ? children : fallback}</>
}

/** The short "An admin ..." line that stands in for a control the viewer cannot use. */
export function AdminOnlyNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs text-content-muted ${className}`.trim()}>{children}</p>
}

/** A page-level version of the note, for a whole form or panel that is read-only. */
export function AdminOnlyBanner({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="rounded-ds-card border border-line bg-surface px-4 py-3 text-sm text-content-body">
      {children}
    </p>
  )
}

/**
 * Disables every input and button inside when `readOnly`, so the values stay
 * readable. Links still work. Unstyled: it adds no border, margin or padding.
 */
export function ReadOnlyFieldset({ readOnly, children, className = '' }: { readOnly: boolean; children: ReactNode; className?: string }) {
  return (
    <fieldset disabled={readOnly} className={`m-0 min-w-0 border-0 p-0 ${className}`.trim()}>
      {children}
    </fieldset>
  )
}
