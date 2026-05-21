import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'

interface Props {
  onAddPayment: () => void
}

const PILLS = [
  { label: '₹0 today' },
  { label: 'Cancel anytime' },
  { label: 'Email reminder before charge' },
]

export function PostSigninTransition({ onAddPayment }: Props) {
  const { user, profile } = useAuthStore()
  const [cardExpanded, setCardExpanded] = useState(false)

  const email = profile?.email ?? user?.email ?? ''
  const initial = email ? email[0].toUpperCase() : 'U'

  return (
    <div
      className="min-h-screen flex justify-center"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -200px, rgba(184,255,90,.05), transparent 60%), #05080a',
      }}
    >
      <div className="w-full max-w-[390px] bg-bg min-h-screen flex flex-col items-center px-6 pt-12 pb-8 relative overflow-auto">
        {/* Corner glows */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background:
              'radial-gradient(380px 280px at 90% -20px, rgba(184,255,90,.10), transparent 60%), radial-gradient(600px 400px at -20% 0%, rgba(184,255,90,.04), transparent 60%)',
          }}
        />

        {/* All content above the account line is z-[1] */}
        <div className="relative z-[1] w-full flex flex-col items-center">

          {/* Check circle */}
          <div
            className="w-[88px] h-[88px] rounded-full flex items-center justify-center relative mt-2 mb-6"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, rgba(184,255,90,.28), rgba(184,255,90,.05) 60%, transparent 70%)',
            }}
          >
            <div
              className="absolute inset-[14px] rounded-full bg-accent"
              style={{ boxShadow: '0 12px 36px -10px rgba(184,255,90,.55)' }}
            />
            <svg
              className="relative z-[1] w-[30px] h-[30px] text-bg"
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

          <h2 className="text-[24px] font-extrabold tracking-[-0.03em] leading-[1.15] text-text text-center mb-2.5">
            Almost there!
          </h2>

          <p className="text-[14.5px] text-text-dim leading-relaxed text-center max-w-[300px] mb-[22px]">
            To start your <span className="font-semibold text-text">7-day trial</span>, add a
            payment method. You won't be charged until{' '}
            <span className="font-semibold text-text">day 8</span>.
          </p>

          {/* Trial pills */}
          <div className="flex flex-wrap justify-center gap-2 mb-7" aria-label="Trial terms">
            {PILLS.map((pill) => (
              <span
                key={pill.label}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-medium text-text"
                style={{
                  background: 'rgba(184,255,90,.06)',
                  border: '1px solid rgba(184,255,90,.35)',
                }}
              >
                <span className="font-mono font-bold text-accent">✓</span>
                {pill.label}
              </span>
            ))}
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={onAddPayment}
            className="w-full max-w-[340px] flex items-center justify-center gap-2 bg-accent text-bg rounded-2xl px-[18px] py-[18px] min-h-[60px] font-extrabold text-[16px] tracking-[-0.005em] active:translate-y-[1px] transition-transform"
            style={{ boxShadow: '0 14px 30px -10px rgba(184,255,90,.5)' }}
          >
            Add Payment Method →
          </button>

          {/* "Why card?" expandable */}
          <div className="mt-[18px] w-full max-w-[340px]">
            <button
              type="button"
              onClick={() => setCardExpanded((v) => !v)}
              className="flex items-center gap-2 px-3 py-3 rounded-[10px] text-[13.5px] text-text-dim transition-colors duration-200 active:text-text mx-auto"
            >
              <span className="underline underline-offset-[3px] decoration-[rgba(138,148,140,.4)] decoration-[1px]">
                Why do we need a card?
              </span>
              <svg
                className="w-3.5 h-3.5 text-text-faint transition-transform duration-200 flex-shrink-0"
                style={{
                  transform: cardExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  color: cardExpanded ? '#b8ff5a' : undefined,
                }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div
              style={{
                maxHeight: cardExpanded ? '200px' : '0',
                overflow: 'hidden',
                transition: 'max-height 0.2s ease',
              }}
            >
              <div className="mt-2 px-4 py-3.5 bg-bg-card border border-border rounded-[12px] text-[13px] text-text-dim leading-[1.55]">
                We ask for a card upfront so only{' '}
                <span className="font-semibold text-text">serious club owners</span> start trials —
                it keeps the experience focused and our support fast.
                <br />
                <br />
                You won't be charged <span className="font-semibold text-text">anything</span> for
                the first 7 days. We'll email you on{' '}
                <span className="font-semibold text-text">day 6</span> as a reminder. If you cancel
                before <span className="font-semibold text-text">day 8</span>, your card is never
                charged.
              </div>
            </div>
          </div>
        </div>

        {/* Account line — pushed to bottom */}
        <div className="mt-auto pt-5 relative z-[1] flex items-center gap-2.5 text-text-faint font-mono text-[12px] tracking-[.02em]">
          <span className="w-6 h-6 rounded-full bg-accent text-bg flex items-center justify-center font-extrabold text-[12px] flex-shrink-0">
            {initial}
          </span>
          <span>Signed in as {email}</span>
        </div>
      </div>
    </div>
  )
}
