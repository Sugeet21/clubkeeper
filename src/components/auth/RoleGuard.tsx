// Phase D (D5) — render-time role gates (Pattern A12).
//
// WHY the client gate matters (D0 finding 2): RLS is defense-in-depth only.
// A staff-queued owner-only write gets a 403 from Supabase and dead-letters
// in the outbox after 10 retries — the UI gate is the PRIMARY defense, so a
// gate must remove the ACTION (every trigger + the modal/sheet mount), not
// just one button.
//
// Role comes from useRole() — the authStore field kept in lockstep with the
// session (D3), decoded lock-free from the JWT claim. It resolves
// synchronously with the session, so these gates never flicker and need no
// loading state. A claim-less live session derives to 'owner' (legacy owner),
// so OwnerOnly is safe for pre-Phase-D users.

import type { ReactNode } from 'react'
import { useRole } from '../../hooks/useRole'

/**
 * Renders children only for role === 'owner'. Staff (and the signed-out
 * null role, unreachable behind RequireAccess) get the fallback.
 */
export function OwnerOnly({
  children,
  fallback = null,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const role = useRole()
  if (role !== 'owner') return <>{fallback}</>
  return <>{children}</>
}

/**
 * Hides children from staff only — owner AND the null role render them.
 * Use when a surface must stay visible during boot; prefer OwnerOnly for
 * anything that triggers an owner-only write.
 */
export function HideForStaff({ children }: { children: ReactNode }) {
  const role = useRole()
  if (role === 'staff') return null
  return <>{children}</>
}
