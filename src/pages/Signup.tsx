import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { SigninForm } from '../components/signup/SigninForm'
import { PostSigninTransition } from '../components/signup/PostSigninTransition'

type Screen = 'form' | 'loading' | 'transition' | 'error'

export default function Signup() {
  const navigate = useNavigate()
  const { session, subscription, subscriptionLoaded, role, loading: authLoading, signInWithGoogle } = useAuthStore()
  const [screen, setScreen] = useState<Screen>('form')
  const isOAuthInFlight = useRef(false)

  // Effect 1 — detect error params in URL (Supabase returns ?error= on OAuth denial)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (p.get('error') || h.get('error')) setScreen('error')
  }, [])

  // Effect 2 — redirect if user is already authenticated
  useEffect(() => {
    if (authLoading) return
    if (!session) return
    // Pattern A6 — subscription===null while refreshProfile() is in flight
    // must not be misread as "no sub" (it flashed the transition screen for
    // every signed-in visitor, including staff, before D3). Wait it out.
    if (!subscriptionLoaded) return

    // D3 — staff never see the "add payment" transition; send them into the
    // app and let RequireAccess route a blocked club subscription to
    // /subscribe, which renders the staff info card.
    if (role === 'staff') {
      navigate('/tables', { replace: true })
      return
    }

    const sub = subscription
    if (!sub || sub.status === 'none') {
      setScreen('transition')                    // signed in, no sub → "Almost there!"
    } else {
      navigate('/tables', { replace: true })     // has active sub → go straight to app
    }
  }, [authLoading, session, subscription, subscriptionLoaded, role, navigate])

  async function handleGoogleSignIn() {
    if (isOAuthInFlight.current) return
    isOAuthInFlight.current = true
    setScreen('loading')
    try {
      await signInWithGoogle()
      // signInWithGoogle redirects the browser — if we reach here it's a test env no-op
    } catch {
      setScreen('error')
    } finally {
      isOAuthInFlight.current = false
    }
  }

  function handleRetry() {
    setScreen('form')
    // brief tick so screen state settles before handleGoogleSignIn reads it
    setTimeout(handleGoogleSignIn, 50)
  }

  if (screen === 'transition') {
    return (
      <PostSigninTransition onAddPayment={() => navigate('/subscribe', { replace: true })} />
    )
  }

  return (
    <SigninForm
      loading={screen === 'loading'}
      hasError={screen === 'error'}
      onGoogleSignIn={handleGoogleSignIn}
      onBack={() => navigate('/')}
      onRetry={handleRetry}
    />
  )
}
