import { GoogleSigninButton } from '../GoogleSigninButton'
import { SigninError } from './SigninError'
import { StaffSigninSection } from './StaffSigninSection'

interface Props {
  loading: boolean
  hasError: boolean
  onGoogleSignIn: () => void
  onBack: () => void
  onRetry: () => void
}

const TRUST_ROWS = [
  { icon: '🔒', label: 'Your data stays on your phone' },
  { icon: '⚡', label: 'Setup in under 5 minutes' },
  { icon: '💰', label: '30-day money-back guarantee' },
]

export function SigninForm({ loading, hasError, onGoogleSignIn, onBack, onRetry }: Props) {
  return (
    <div
      className="min-h-screen flex justify-center"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -200px, rgba(184,255,90,.05), transparent 60%), #05080a',
      }}
    >
      <div className="w-full max-w-[390px] bg-bg min-h-screen flex flex-col relative overflow-hidden">
        {/* Corner glows */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background:
              'radial-gradient(380px 280px at 90% -20px, rgba(184,255,90,.10), transparent 60%), radial-gradient(600px 400px at -20% 0%, rgba(184,255,90,.04), transparent 60%)',
          }}
        />

        {/* Top bar */}
        <header
          className="relative z-[5] h-[60px] grid items-center px-3 border-b"
          style={{
            gridTemplateColumns: '44px 1fr 44px',
            background: 'rgba(10,14,12,.78)',
            backdropFilter: 'saturate(140%) blur(10px)',
            WebkitBackdropFilter: 'saturate(140%) blur(10px)',
            borderColor: 'rgba(42,50,45,.6)',
          }}
        >
          <button
            onClick={onBack}
            aria-label="Back to landing"
            className="w-11 h-11 rounded-[12px] flex items-center justify-center text-text-dim border border-transparent transition-all duration-200 active:bg-bg-card active:border-border active:text-text"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="font-extrabold text-[16px] tracking-tight text-center text-text">
            Club<span className="text-accent">Keeper</span>
          </div>
          <div />
        </header>

        {/* Content */}
        <div className="relative z-[1] flex-1 flex flex-col px-[22px] pb-6">
          {/* Hero */}
          <section className="pt-14 pb-9 flex flex-col gap-3.5">
            <span className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.22em] text-text-faint font-medium">
              <span className="w-[18px] h-px bg-text-faint flex-shrink-0" />
              Get started
            </span>
            <h1 className="text-[30px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
              Welcome to <span className="text-accent">ClubKeeper</span>
            </h1>
            <p className="text-[15.5px] text-text-dim leading-relaxed max-w-[330px]">
              Sign in with Google to start your 7-day free trial. No charge until day 8.
            </p>
          </section>

          {/* Google sign-in */}
          <section>
            <GoogleSigninButton loading={loading} onClick={onGoogleSignIn} />
            <p className="mt-3.5 text-center text-[12px] text-text-faint leading-relaxed">
              By continuing, you agree to our{' '}
              <a href="#" className="text-text-dim underline underline-offset-[2px] decoration-[rgba(138,148,140,.5)] decoration-[1px]">
                Terms
              </a>{' '}
              and{' '}
              <a href="#" className="text-text-dim underline underline-offset-[2px] decoration-[rgba(138,148,140,.5)] decoration-[1px]">
                Privacy Policy
              </a>
              .
            </p>
          </section>

          {/* Staff sign-in (D3) — collapsed; owner-issued username + password */}
          <StaffSigninSection />

          {/* Trust rows */}
          <section className="mt-7 flex flex-col gap-2" aria-label="Why ClubKeeper is safe">
            {TRUST_ROWS.map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 bg-bg-card border border-border rounded-[12px] px-3.5 py-3 min-h-[56px]"
              >
                <div className="w-8 h-8 flex-shrink-0 rounded-[10px] bg-[#0f1411] border border-border flex items-center justify-center text-[16px]">
                  {row.icon}
                </div>
                <span className="font-mono text-[12.5px] text-text tracking-[.01em] font-medium">
                  {row.label}
                </span>
              </div>
            ))}
          </section>

          {/* Spacer */}
          <div className="flex-1 min-h-6" />

          {/* Already a user */}
          <section className="mt-7 flex flex-col gap-2.5">
            <span className="text-center text-text-dim text-[14px]">Already have an account?</span>
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="w-full flex items-center justify-center gap-2 border border-border rounded-2xl px-[18px] py-3.5 min-h-[52px] font-semibold text-[15px] text-text transition-all duration-200 active:bg-bg-card active:border-text-faint"
            >
              Sign in
            </button>
          </section>

          {/* Footer */}
          <div className="mt-6 pb-2 text-center text-text-faint text-[11.5px] font-mono tracking-[.04em]">
            Made with ❤️ in Pune, India
          </div>
        </div>

        {/* Error toast */}
        {hasError && <SigninError onRetry={onRetry} />}
      </div>
    </div>
  )
}
