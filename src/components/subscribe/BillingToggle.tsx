type Billing = 'monthly' | 'annual'

interface Props {
  billing: Billing
  onChange: (b: Billing) => void
}

export function BillingToggle({ billing, onChange }: Props) {
  return (
    <div
      className="grid grid-cols-2 bg-[#0f1411] border border-border rounded-[14px] p-1 my-[18px]"
      role="tablist"
      aria-label="Billing period"
    >
      {(['monthly', 'annual'] as const).map((b) => {
        const on = billing === b
        return (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(b)}
            className={`py-3 min-h-[44px] rounded-[10px] font-semibold text-[13.5px] tracking-[-0.005em] transition-all duration-200 flex items-center justify-center gap-1.5 ${
              on ? 'bg-accent text-bg' : 'text-text-dim'
            }`}
            style={on ? { boxShadow: '0 2px 8px rgba(184,255,90,.25)' } : undefined}
          >
            {b === 'monthly' ? 'Monthly' : 'Annual'}
            {b === 'annual' && (
              <span
                className={`font-mono text-[10.5px] px-1.5 py-0.5 rounded-[6px] tracking-[.04em] ${
                  on ? 'text-bg bg-black/[.12]' : 'text-accent bg-accent/10'
                }`}
              >
                save 2 mo
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
