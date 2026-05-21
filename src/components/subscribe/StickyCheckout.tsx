type PlanId = 'starter' | 'standard'
type Billing = 'monthly' | 'annual'

interface Props {
  selectedPlan: PlanId
  billing: Billing
  currentPrice: number
  trialEndDate: string
  onCheckout: () => void
}

const PLAN_NAMES: Record<PlanId, string> = {
  starter: 'Starter Plan',
  standard: 'Standard Plan',
}

function rupee(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

export function StickyCheckout({ selectedPlan, billing, currentPrice, trialEndDate, onCheckout }: Props) {
  const period = billing === 'monthly' ? '/ month' : '/ year'

  return (
    <div
      className="flex-shrink-0 relative z-[7] px-4 pt-3.5 pb-[18px] border-t"
      style={{
        background: 'linear-gradient(180deg, rgba(10,14,12,.6), rgba(10,14,12,.95) 30%, #0a0e0c)',
        backdropFilter: 'saturate(140%) blur(14px)',
        WebkitBackdropFilter: 'saturate(140%) blur(14px)',
        borderColor: 'rgba(42,50,45,.6)',
        boxShadow: '0 -20px 30px -20px rgba(0,0,0,.4)',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Summary */}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[.18em] text-text-faint">
            Selected
          </span>
          <span className="font-bold text-[14px] text-text truncate">
            {PLAN_NAMES[selectedPlan]} ·{' '}
            <span className="font-mono">{rupee(currentPrice)}</span>{' '}
            <span className="text-text-dim font-normal">{period}</span>
          </span>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onCheckout}
          className="flex-shrink-0 flex items-center gap-2 bg-accent text-bg font-extrabold text-[15px] tracking-[-0.01em] px-[18px] min-h-[54px] rounded-[14px] active:translate-y-[1px] transition-transform"
          style={{ boxShadow: '0 8px 22px -8px rgba(184,255,90,.55)' }}
        >
          <span>Start Free Trial</span>
          <span className="font-mono">→</span>
        </button>
      </div>

      <div className="mt-2 text-center font-mono text-[10.5px] tracking-[.06em] text-text-faint">
        ₹0 today · {rupee(currentPrice)} charged on {trialEndDate}
        {' · '}
        <span className="text-text-dim">Secured by Razorpay</span>
      </div>
    </div>
  )
}
