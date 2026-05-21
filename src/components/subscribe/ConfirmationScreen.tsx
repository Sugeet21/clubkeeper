interface Props {
  email: string
  trialEndDate: string
  onContinue: () => void
}

export function ConfirmationScreen({ email, trialEndDate, onContinue }: Props) {
  return (
    <div
      className="min-h-screen flex justify-center"
      style={{ background: 'radial-gradient(1200px 600px at 50% -200px, rgba(184,255,90,.05), transparent 60%), #05080a' }}
    >
      <div className="w-full max-w-[390px] bg-bg min-h-screen flex flex-col items-center justify-center px-6 text-center relative overflow-hidden">
        {/* Corner glows */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background:
              'radial-gradient(380px 280px at 90% -20px, rgba(184,255,90,.10), transparent 60%), radial-gradient(600px 400px at -20% 0%, rgba(184,255,90,.04), transparent 60%)',
          }}
        />

        {/* Content */}
        <div className="relative z-[1] flex flex-col items-center">
          {/* Check circle */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center relative mb-6"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, rgba(184,255,90,.25), rgba(184,255,90,.06) 60%, transparent 70%)',
            }}
          >
            <div
              className="absolute inset-[14px] rounded-full bg-accent"
              style={{ boxShadow: '0 12px 40px -10px rgba(184,255,90,.5)' }}
            />
            <svg
              className="relative z-[1] w-8 h-8 text-bg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-text mb-2.5">
            Trial started!
          </h1>

          <p className="text-[15px] text-text-dim leading-relaxed max-w-[300px]">
            Your 7-day free trial is active. Let's set up your club. We'll email you before charging on day 8.
          </p>

          <button
            onClick={onContinue}
            className="mt-7 w-full max-w-[320px] bg-accent text-bg font-extrabold text-[15px] tracking-[-0.005em] px-4 py-4 rounded-[14px] active:translate-y-[1px] transition-transform"
            style={{ boxShadow: '0 8px 24px -8px rgba(184,255,90,.55)' }}
          >
            Continue to ClubKeeper →
          </button>

          <p className="mt-3.5 font-mono text-[11.5px] text-text-faint tracking-[.02em]">
            Trial confirmation sent to {email}
          </p>
        </div>
      </div>
    </div>
  )
}
