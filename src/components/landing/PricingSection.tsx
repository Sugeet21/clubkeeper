import { Eyebrow } from './Eyebrow'

const STARTER_FEATURES = [
  'Up to 3 tables',
  'Live timer + pause/resume',
  'Daily revenue summary',
  'Works offline (no WiFi needed)',
  'Setup support via WhatsApp',
]

const STANDARD_FEATURES = [
  'Up to 8 tables',
  'Everything in Starter',
  'Multi-day history & reports',
  'Export data to Excel / CSV',
  'Time rounding (15min / 30min)',
  'Priority WhatsApp support',
]

const PRO_FEATURES: { text: string; soon: boolean }[] = [
  { text: 'Unlimited tables', soon: false },
  { text: 'Everything in Standard', soon: false },
  { text: 'Multi-staff login (coming soon)', soon: true },
  { text: 'WhatsApp bill sharing (coming soon)', soon: true },
  { text: 'Monthly P&L report (coming soon)', soon: true },
  {
    text: 'Live owner dashboard — peak hours, top tables, today vs. yesterday (coming soon)',
    soon: true,
  },
  { text: 'Multi-location support (coming soon)', soon: true },
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

function Circle() {
  return (
    <span className="font-mono text-text-faint flex-shrink-0 mt-[1px]">○</span>
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

      <div className="flex flex-col gap-3.5">
        {/* ── Starter ── */}
        <div className="bg-bg-card border border-border rounded-[20px] p-[22px]">
          <span className="font-mono text-[11px] uppercase tracking-[.22em] text-text-faint font-semibold">
            Starter
          </span>
          <div className="flex items-baseline gap-2 mt-2.5">
            <span className="font-mono font-bold text-[44px] tracking-[-0.03em] text-text leading-none">
              ₹299
            </span>
            <span className="text-[14px] text-text-dim">/ month</span>
          </div>
          <TrialPill />
          <p className="mt-1.5 text-[14px] text-text-dim">Perfect for small clubs</p>
          <ul className="mt-[18px] mb-5 flex flex-col gap-2.5">
            {STARTER_FEATURES.map((f) => (
              <li key={f} className="flex gap-2.5 items-start text-[14px] text-text leading-[1.4]">
                <Check />
                {f}
              </li>
            ))}
          </ul>
          <button
            onClick={onCTA}
            className="w-full min-h-[54px] py-4 rounded-2xl text-[16px] font-bold text-text border border-border active:scale-[0.99] transition-transform"
          >
            Start free trial
          </button>
        </div>

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

        {/* ── Pro (coming soon) ── */}
        <div className="bg-bg-card border border-border rounded-[20px] p-[22px] opacity-[.92]">
          <span className="font-mono text-[11px] uppercase tracking-[.22em] text-text-faint font-semibold">
            Pro
          </span>
          <div className="flex items-baseline gap-2 mt-2.5">
            <span className="font-mono font-bold text-[44px] tracking-[-0.03em] text-text leading-none">
              ₹999
            </span>
            <span className="text-[14px] text-text-dim">/ month</span>
          </div>
          <div className="inline-flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-full bg-[#0f1411] border border-border font-mono text-[10.5px] uppercase tracking-[.14em] font-semibold text-text-faint">
            <span className="w-1.5 h-1.5 rounded-full bg-text-faint" />
            Coming soon
          </div>
          <p className="mt-1.5 text-[14px] text-text-dim">For large clubs &amp; chains</p>
          <ul className="mt-[18px] mb-5 flex flex-col gap-2.5">
            {PRO_FEATURES.map((f) => (
              <li
                key={f.text}
                className={`flex gap-2.5 items-start text-[14px] leading-[1.4] ${
                  f.soon ? 'text-text-dim' : 'text-text'
                }`}
              >
                {f.soon ? <Circle /> : <Check />}
                {f.text}
              </li>
            ))}
          </ul>
          <button
            disabled
            className="w-full min-h-[54px] py-4 rounded-2xl text-[16px] font-bold text-text-dim border border-dashed border-border cursor-not-allowed"
          >
            Notify me when ready
          </button>
        </div>
      </div>

      <p className="mt-[18px] text-center text-[12px] text-text-dim">
        Annual billing saves you 2 months. Trial applies to both plans.
      </p>
    </section>
  )
}
