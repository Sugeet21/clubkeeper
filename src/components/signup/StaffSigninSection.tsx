import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Phase D (D3) — staff email/password sign-in, collapsed below the Google
// button. Staff usernames are the fake emails minted by api/create-staff
// (<name>.<4 digits>@<clubslug>.ck.local) — the owner hands them over on
// paper together with the show-once password. On success supabase-js fires
// onAuthStateChange(SIGNED_IN) → authStore sets session + role → Signup's
// redirect effect takes over. No navigation here.

export function StaffSigninSection() {
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pattern A4 — double-tap guard. The ref blocks re-entry synchronously;
  // `signingIn` state only drives the disabled/label UI.
  const inFlight = useRef(false)

  async function handleSignIn() {
    if (inFlight.current) return
    if (!username.trim() || !password) {
      setError('Enter both username and password.')
      return
    }
    inFlight.current = true
    setSigningIn(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: username.trim().toLowerCase(),
        password,
      })
      if (authError) {
        const msg = authError.message
        if (msg === 'Invalid login credentials') {
          setError('Wrong username or password. Ask the owner to check or reset it.')
        } else if (/not active|banned/i.test(msg)) {
          // active=false: the access-token hook raises at mint, and revoke
          // also bans the auth user — both surface here.
          setError('This account has been removed by the owner.')
        } else {
          console.error('[StaffSigninSection] sign-in failed', authError)
          setError('Sign-in failed. Check your connection and try again.')
        }
      }
      // Success: session lands via onAuthStateChange; Signup redirects.
    } catch (err) {
      console.error('[StaffSigninSection] sign-in threw', err)
      setError('Sign-in failed. Check your connection and try again.')
    } finally {
      inFlight.current = false
      setSigningIn(false)
    }
  }

  const inputClass =
    'w-full min-h-[48px] px-3.5 rounded-[12px] bg-bg-card border border-border text-text text-[15px] placeholder:text-text-faint focus:outline-none focus:border-accent'

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 min-h-[44px] px-1 text-text-dim text-[13.5px] font-medium"
      >
        <span className="flex items-center gap-2">
          <span className="w-[18px] h-px bg-text-faint flex-shrink-0" />
          Staff sign-in
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2.5">
          <input
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Username (from the owner)"
            aria-label="Staff username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="Password"
            aria-label="Staff password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-[12.5px] leading-[1.4] text-busy px-1">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full min-h-[48px] rounded-2xl border border-border bg-bg-card font-semibold text-[15px] text-text transition-all duration-200 active:border-text-faint disabled:opacity-60"
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      )}
    </section>
  )
}
