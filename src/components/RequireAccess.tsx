import { Navigate, Outlet } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAccessGuard } from '../hooks/useAccessGuard'

export function RequireAccess() {
  const guard = useAccessGuard()
  const navigate = useNavigate()

  useEffect(() => {
    if (!guard.canAccess && guard.reason === 'trial_expired') {
      navigate('/subscribe', { replace: true, state: { reason: 'trial_expired' } })
    }
  }, [guard, navigate])

  if (!guard.canAccess) {
    if (guard.reason === 'loading' || guard.reason === 'db_loading' || guard.reason === 'subscription_loading') {
      // 'db_loading': auth is done but per-user IndexedDB is still opening.
      // 'subscription_loading': DB ready but refreshProfile() hasn't resolved yet —
      // subscription===null in this window must NOT be treated as no_subscription.
      // Show the same spinner for all three — never redirect during transient loading.
      return (
        <div className="min-h-screen flex items-center justify-center text-text-dim text-sm font-mono">
          Loading…
        </div>
      )
    }
    if (guard.reason === 'not_authenticated') {
      return <Navigate to="/signup" replace />
    }
    if (guard.reason === 'trial_expired') {
      // Navigated imperatively in useEffect above (with state); render null while redirecting.
      return null
    }
    // no_subscription | subscription_ended
    return <Navigate to="/subscribe" replace />
  }

  return <Outlet />
}
