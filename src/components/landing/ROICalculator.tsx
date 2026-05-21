import { useState } from 'react'
import { Eyebrow } from './Eyebrow'

const FORGET_OPTIONS = [1, 2, 3, 5, 10]
const RATE_OPTIONS = [60, 100, 120, 150, 200]
const DAYS = 30
const PLAN_PRICE = 599

function inFormat(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

export function ROICalculator() {
  const [forgetCount, setForgetCount] = useState(3)
  const [ratePerHour, setRatePerHour] = useState(120)

  const monthly = forgetCount * ratePerHour * DAYS
  const yearly = monthly * 12
  const roi = Math.max(1, Math.round(monthly / PLAN_PRICE))

  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>The math</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          Calculate what you're losing
        </h2>
      </div>

      <div className="bg-bg-card border border-border rounded-[20px] p-5">
        {/* Forget count */}
        <div className="mb-[18px]">
          <p className="text-[13px] text-text-dim mb-2.5 leading-relaxed">
            How many times per day does staff forget the timer?
          </p>
          <div role="radiogroup" aria-label="Times per day" className="grid grid-cols-5 gap-1.5">
            {FORGET_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={forgetCount === v}
                onClick={() => setForgetCount(v)}
                className={`py-3 rounded-[12px] font-mono font-semibold text-[14px] min-h-[44px] border transition-all duration-200 active:scale-[.97] ${
                  forgetCount === v
                    ? 'bg-accent text-bg border-accent'
                    : 'bg-[#0f1411] text-text border-border'
                }`}
                style={
                  forgetCount === v
                    ? { boxShadow: '0 0 0 4px rgba(184,255,90,.12)' }
                    : undefined
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Rate */}
        <div className="mb-[18px]">
          <p className="text-[13px] text-text-dim mb-2.5 leading-relaxed">
            What's your average rate per hour?
          </p>
          <div role="radiogroup" aria-label="Rate per hour" className="grid grid-cols-5 gap-1.5">
            {RATE_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={ratePerHour === v}
                onClick={() => setRatePerHour(v)}
                className={`py-3 rounded-[12px] font-mono font-semibold text-[13px] min-h-[44px] border transition-all duration-200 active:scale-[.97] ${
                  ratePerHour === v
                    ? 'bg-accent text-bg border-accent'
                    : 'bg-[#0f1411] text-text border-border'
                }`}
                style={
                  ratePerHour === v
                    ? { boxShadow: '0 0 0 4px rgba(184,255,90,.12)' }
                    : undefined
                }
              >
                ₹{v}
              </button>
            ))}
          </div>
        </div>

        {/* Output */}
        <div className="pt-[18px] border-t border-dashed border-border">
          <div className="font-mono font-bold text-[38px] tracking-[-0.02em] text-accent leading-none">
            {inFormat(monthly)}
            <span className="text-[16px] text-text-dim font-medium ml-1.5">lost / month</span>
          </div>
          <p className="mt-2.5 text-[13px] text-text-dim">
            That's{' '}
            <span className="font-semibold text-text">{inFormat(yearly)}</span> every year. Gone.
            Forever.
          </p>
        </div>
      </div>

      {/* ROI callout */}
      <div
        className="mt-3.5 flex items-center gap-2.5 px-4 py-3.5 rounded-[14px] text-[13px] text-text-dim"
        style={{
          background: 'rgba(184,255,90,.12)',
          border: '1px solid rgba(184,255,90,.35)',
        }}
      >
        <span className="text-accent font-bold text-[16px] flex-shrink-0">↳</span>
        <span>
          ClubKeeper is <span className="text-accent font-bold">free for 7 days</span>, then{' '}
          <span className="text-accent font-bold">₹599/month</span>. ROI:{' '}
          <span className="text-accent font-bold">{roi}×</span>.
        </span>
      </div>
    </section>
  )
}
