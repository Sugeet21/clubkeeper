import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToastStore } from '../store/toastStore'

export function AuthCallback() {
  const navigate = useNavigate()
  const location = useLocation()
  const { subscription, loading, user } = useAuthStore()

  console.log('[AuthCallback] render', {
    loading,
    user: !!user,
    subscription: subscription?.status,
    hash: location.hash.slice(0, 40) || '(none)',
  })

  // Safety net: if Supabase hangs and loading never clears, bail after 20s.
  useEffect(() => {
    const t = setTimeout(() => {
      if (useAuthStore.getState().loading) {
        useToastStore.getState().show('Sign-in is taking too long. Please try again.', 'error')
        navigate('/', { replace: true })
      }
    }, 20_000)
    return () => clearTimeout(t)
  }, [navigate])

  useEffect(() => {
    console.log('[AuthCallback effect] entered', {
      loading,
      user: !!user,
      subscription: subscription?.status,
    })

    if (loading) {
      console.log('[AuthCallback effect] waiting — loading=true, returning')
      return
    }

    // Route based on subscription state after OAuth completes
    const sub = subscription
    if (!sub || sub.status === 'none' || sub.status === 'cancelled' || sub.status === 'expired') {
      console.log('[AuthCallback effect] navigating → /subscribe (no active sub)')
      navigate('/subscribe', { replace: true })
    } else if (sub.status === 'trialing') {
      const trialActive = sub.trialEndsAt ? sub.trialEndsAt > Date.now() : false
      if (trialActive) {
        console.log('[AuthCallback effect] navigating → /tables (trialing)')
        navigate('/tables', { replace: true })
      } else {
        console.log('[AuthCallback effect] navigating → /subscribe (trial_expired)')
        navigate('/subscribe', { replace: true, state: { reason: 'trial_expired' } })
      }
    } else if (sub.status === 'active' || sub.status === 'past_due') {
      console.log('[AuthCallback effect] navigating → /tables')
      navigate('/tables', { replace: true })
    } else {
      console.log('[AuthCallback effect] navigating → /subscribe (fallback)')
      navigate('/subscribe', { replace: true })
    }
  }, [loading, subscription, user, navigate])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center text-text-dim text-sm font-mono">
      Signing you in…
    </div>
  )
}
