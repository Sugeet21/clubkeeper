import { Eyebrow } from './Eyebrow'

// V1-LAUNCH: STARTER_FEATURES and PRO_FEATURES kept in PlanSelection.tsx (subscribe flow). Removed from landing to avoid TS unused-var errors. Restore when tiering re-enabled.

const STANDARD_FEATURES = [
  'Up to 8 tables',
  'Everything in Starter',
  'Multi-day history & reports',
  'Export data to Excel / CSV',
  'Time rounding (15min / 30min)',
  'Priority WhatsApp support',
]

function TrialPill() {
  return (
    <div
      className="inline-flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-full font-mono text-[10.5px] uppercase tracking-[.14em] font-semibold text-accent"
      style={{ background: 'rgba(184,255,90,.12)', border: '1px solid rgba(184,255,90,.35)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
      Free for 7 days
    </div>
  )
}

function Check() {
  return (
    <span className="font-mono font-bold text-accent flex-shrink-0 mt-[1px]">✓</span>
  )
}

export function PricingSection({ onCTA }: { onCTA: () => void }) {
  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>Pricing</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          Simple pricing. No surprises.
        </h2>
      </div>

      {/* Trial banner */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-3 rounded-[14px] mb-[18px] text-[13px] text-text-dim"
        style={{
          background: 'rgba(184,255,90,.04)',
          border: '1px dashed rgba(184,255,90,.35)',
        }}
      >
        <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-accent text-bg font-mono font-extrabold text-[13px] flex items-center justify-center">
          7d
        </span>
        <span>
          <span className="font-bold text-text">Every plan starts free for 7 days.</span> Card
          required · cancel anytime before day 8.
        </span>
      </div>

      {/* V1-LAUNCH: showing only Standard Monthly. Revert this block to re-enable tiering (see SKILL.md "scope gating deferred"). */}
      <div className="flex flex-col gap-3.5">
        {/* ── Starter hidden for V1-LAUNCH ── */}

        {/* ── Standard (featured) ── */}
        <div
          className="rounded-[20px] p-[22px] relative"
          style={{
            background:
              'radial-gradient(420px 200px at 100% 0%, rgba(184,255,90,.08), transparent 60%), #1a201c',
            border: '1px solid rgba(184,255,90,.35)',
            boxShadow:
              '0 0 0 1px rgba(184,255,90,.35), 0 30px 60px -30px rgba(184,255,90,.25), inset 0 1px 0 rgba(184,255,90,.06)',
          }}
        >
          <span
            className="absolute -top-3 right-[18px] font-mono text-[10.5px] uppercase tracking-[.18em] font-bold bg-accent text-bg px-2.5 py-1.5 rounded-full"
            style={{ boxShadow: '0 6px 18px -4px rgba(184,255,90,.5)' }}
          >
            Most popular
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[.22em] text-accent font-semibold">
            Standard
          </span>
          <div className="flex items-baseline gap-2 mt-2.5">
            <span className="font-mono font-bold text-[44px] tracking-[-0.03em] text-text leading-none">
              ₹599
            </span>
            <span className="text-[14px] text-text-dim">/ month</span>
          </div>
          <TrialPill />
          <p className="mt-1.5 text-[14px] text-text-dim">For growing clubs</p>
          <ul className="mt-[18px] mb-5 flex flex-col gap-2.5">
            {STANDARD_FEATURES.map((f) => (
              <li key={f} className="flex gap-2.5 items-start text-[14px] text-text leading-[1.4]">
                <Check />
                {f}
              </li>
            ))}
          </ul>
          <button
            onClick={onCTA}
            className="w-full min-h-[54px] py-4 rounded-2xl text-[16px] font-bold bg-accent text-bg active:scale-[0.99] transition-transform"
            style={{
              boxShadow: '0 8px 24px -8px rgba(184,255,90,.45), inset 0 -2px 0 rgba(0,0,0,.08)',
            }}
          >
            Start free trial
          </button>
        </div>

        {/* ── Pro hidden for V1-LAUNCH ── */}
      </div>

      <p className="mt-[18px] text-center text-[12px] text-text-dim">
        7-day free trial · cancel anytime before day 8.
      </p>
    </section>
  )
}
