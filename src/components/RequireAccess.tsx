import { Navigate, Outlet } from 'react-router-dom'
import { useAccessGuard } from '../hooks/useAccessGuard'

export function RequireAccess() {
  const guard = useAccessGuard()

  if (!guard.canAccess) {
    if (guard.reason === 'loading') {
      return (
        <div className="min-h-screen flex items-center justify-center text-text-dim text-sm font-mono">
          Loading…
        </div>
      )
    }
    if (guard.reason === 'not_authenticated') {
      return <Navigate to="/signup" replace />
    }
    // needs_subscription | trial_ended | subscription_ended
    return <Navigate to="/subscribe" replace />
  }

  return <Outlet />
}
