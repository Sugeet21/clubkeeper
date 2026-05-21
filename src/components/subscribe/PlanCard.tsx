type Billing = 'monthly' | 'annual'

interface Feature {
  text: string
  soon: boolean
}

interface Props {
  id: 'starter' | 'standard' | 'pro'
  name: string
  billing: Billing
  monthlyPrice: number
  annualPrice: number
  subtitle: string
  features: Feature[]
  featured: boolean
  disabled: boolean
  badge: string | null
  selected: boolean
  onSelect: () => void
}

function rupee(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

export function PlanCard({
  id, name, billing, monthlyPrice, annualPrice,
  subtitle, features, featured, disabled, badge, selected, onSelect,
}: Props) {
  const isAnnual = billing === 'annual'
  const displayPrice = isAnnual ? Math.round(annualPrice / 12) : monthlyPrice
  const annualTotal = annualPrice
  const savings = monthlyPrice * 12 - annualPrice

  function handleClick() {
    if (!disabled) onSelect()
  }

  return (
    <div
      onClick={handleClick}
      className={`relative bg-bg-card rounded-[20px] p-5 cursor-pointer transition-all duration-200 active:scale-[.995] ${
        disabled ? 'opacity-[.92] cursor-default' : ''
      } ${
        featured && !selected
          ? 'border border-accent/35'
          : selected
          ? 'border-2 border-accent'
          : 'border border-border'
      }`}
      style={
        selected
          ? { boxShadow: '0 0 0 2px #b8ff5a, 0 30px 60px -30px rgba(184,255,90,.35)' }
          : featured && !selected
          ? {
              background:
                'radial-gradient(420px 200px at 100% 0%, rgba(184,255,90,.08), transparent 60%), #1a201c',
              boxShadow: '0 30px 60px -30px rgba(184,255,90,.22)',
            }
          : undefined
      }
    >
      {/* Plan head */}
      <div className="flex items-start justify-between gap-2.5">
        <span
          className={`font-mono text-[11px] uppercase tracking-[.22em] font-semibold ${
            featured ? 'text-accent' : 'text-text-faint'
          }`}
        >
          {name}
        </span>
        {badge ? (
          <span
            className={`font-mono text-[10px] uppercase tracking-[.18em] font-bold px-[9px] py-[5px] rounded-full ${
              disabled
                ? 'text-text-faint border border-border bg-transparent'
                : 'bg-accent text-bg'
            }`}
            style={
              !disabled
                ? { boxShadow: '0 6px 18px -4px rgba(184,255,90,.5)' }
                : undefined
            }
          >
            {badge}
          </span>
        ) : (
          // Select tick (shown for plans without a badge — i.e. Starter)
          <span
            className={`w-6 h-6 rounded-full border flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
              selected
                ? 'bg-accent border-accent text-bg'
                : 'bg-[#0f1411] border-border text-transparent'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        )}
      </div>

      {/* Price */}
      <div className="flex items-baseline gap-2 mt-3">
        <span
          className={`font-mono font-bold tracking-[-0.03em] text-text leading-none ${
            featured ? 'text-[44px]' : 'text-[38px]'
          }`}
        >
          {rupee(displayPrice)}
        </span>
        <span className="text-text-dim text-[13.5px]">/ month</span>
      </div>

      {/* Annual sub-line */}
      <div className="mt-1.5 font-mono text-[12px] text-text-faint min-h-[18px]">
        {isAnnual && !disabled ? (
          <>
            Billed annually · {rupee(annualTotal)}&nbsp;
            <span className="text-accent">save {rupee(savings)}</span>
          </>
        ) : null}
      </div>

      <p className="mt-2 text-text-dim text-[13.5px]">{subtitle}</p>

      {/* Features */}
      <ul className="mt-4 mb-[18px] flex flex-col gap-2">
        {features.map((f) => (
          <li
            key={f.text}
            className={`flex gap-2.5 items-start text-[13.5px] leading-[1.4] ${
              f.soon ? 'text-text-dim' : 'text-text'
            }`}
          >
            <span
              className={`flex-shrink-0 font-mono font-bold text-[13px] mt-[1px] ${
                f.soon ? 'text-text-faint' : 'text-accent'
              }`}
            >
              {f.soon ? '○' : '✓'}
            </span>
            {f.text}
          </li>
        ))}
      </ul>

      {/* Button */}
      {disabled ? (
        <button
          disabled
          className="w-full min-h-[48px] py-3 px-4 rounded-[14px] font-bold text-[14.5px] text-text-dim border border-dashed border-border cursor-default"
        >
          Notify me when ready
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect() }}
          className={`w-full min-h-[48px] py-3 px-4 rounded-[14px] font-bold text-[14.5px] tracking-[-0.005em] transition-all duration-200 border ${
            featured
              ? 'bg-accent text-bg border-transparent'
              : 'bg-transparent text-text border-border'
          }`}
          style={
            featured
              ? { boxShadow: '0 8px 22px -10px rgba(184,255,90,.45)' }
              : undefined
          }
        >
          Select {name}
        </button>
      )}
    </div>
  )
}
