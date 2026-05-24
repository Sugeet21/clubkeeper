import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

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
    if (!subscription || subscription.status === 'none') {
      console.log('[AuthCallback effect] navigating → /subscribe')
      navigate('/subscribe', { replace: true })
    } else {
      console.log('[AuthCallback effect] navigating → /tables')
      navigate('/tables', { replace: true })
    }
  }, [loading, subscription, user, navigate])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center text-text-dim text-sm font-mono">
      Signing you in…
    </div>
  )
}
