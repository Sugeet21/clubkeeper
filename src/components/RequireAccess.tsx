import { Navigate, Outlet } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAccessGuard } from '../hooks/useAccessGuard'
import { useAuthStore } from '../store/authStore'

export function RequireAccess() {
  const guard = useAccessGuard()
  const navigate = useNavigate()
  // #120 — when a stranded GoTrue lock is jamming auth, the spinner can be
  // long-lived (expired stored token can't boot degraded). Explain the stall
  // instead of freezing silently.
  const authLockBlocked = useAuthStore((s) => s.authLockBlocked)

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
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-text-dim text-sm font-mono">
          Loading…
          {authLockBlocked && (
            <p className="max-w-[300px] px-4 text-center text-xs text-amber-400 font-sans">
              Another ClubKeeper tab is blocking sign-in. Close other ClubKeeper tabs or restart your browser.
            </p>
          )}
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
