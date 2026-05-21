import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export function AuthCallback() {
  const navigate = useNavigate()
  const { subscription, loading } = useAuthStore()

  useEffect(() => {
    if (loading) return

    // Route based on subscription state after OAuth completes
    if (!subscription || subscription.status === 'none') {
      navigate('/subscribe', { replace: true })
    } else {
      navigate('/tables', { replace: true })
    }
  }, [loading, subscription, navigate])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center text-text-dim text-sm font-mono">
      Signing you in…
    </div>
  )
}
