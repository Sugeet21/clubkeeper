import { customerFullLabel, formattedPhone } from '../../lib/customerDisplay'
import type { Customer } from '../../types/customer'

interface Props {
  customer: Customer
  distanceLabel: string
  onClick: () => void
}

export default function CustomerListRow({ customer, distanceLabel, onClick }: Props) {
  const primaryLabel = customerFullLabel(customer)
  const secondaryLabel = formattedPhone(customer)

  // Avatar initial: first char of name, walk-in code, or "C" for unnamed-with-phone
  const avatarChar = customer.name
    ? customer.name[0].toUpperCase()
    : customer.walkInCode
    ? 'W'
    : 'C'

  return (
    <button
      onClick={onClick}
      className="w-full min-h-[64px] bg-bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3 text-left"
    >
      {/* Avatar circle */}
      <div className="w-10 h-10 rounded-full bg-accent/15 border border-accent/20 flex items-center justify-center shrink-0">
        <span className="text-accent font-bold text-[15px]">{avatarChar}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-text truncate">{primaryLabel}</p>
        {secondaryLabel && (
          <p className="text-[12px] text-text-faint font-mono truncate">{secondaryLabel}</p>
        )}
      </div>

      {/* Balance + last visit */}
      <div className="text-right shrink-0">
        <p className="text-[15px] font-bold text-accent">
          ₹{customer.walletBalance.toLocaleString('en-IN')}
        </p>
        <p className="text-[11px] text-text-faint">{distanceLabel}</p>
      </div>
    </button>
  )
}
