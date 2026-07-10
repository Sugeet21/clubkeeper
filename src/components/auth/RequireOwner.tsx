// Phase D (D7) — route-level owner gate (Pattern A12).
//
// Sits INSIDE RequireAccess as a nested layout route: staff deep-linking an
// owner-only URL bounce to /tables before the child ever mounts (Navigate
// renders nothing — no content flash). Role resolves synchronously with the
// session (useRole reads the store field kept in lockstep by D3), so there is
// no loading window to guard. Only 'staff' bounces — a claim-less live
// session derives 'owner' (legacy owner, full UI — never break this).
//
// Route-level gating is for pages with NO staff-reduced view (currently only
// /piggy). Pages with a staff variant (/summary, /history, /settings) branch
// on role INSIDE the page component instead — do not wrap those here.

import { Navigate, Outlet } from 'react-router-dom'
import { useRole } from '../../hooks/useRole'

export function RequireOwner() {
  const role = useRole()
  if (role === 'staff') return <Navigate to="/tables" replace />
  return <Outlet />
}
