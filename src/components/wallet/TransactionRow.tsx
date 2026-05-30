import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { WalletTransaction } from '../../types/walletTransaction'

interface Props {
  transaction: WalletTransaction
  customerPhone: string | null
  customerName: string | null
}

export default function TransactionRow({ transaction, customerPhone, customerName }: Props) {
  const [expanded, setExpanded] = useState(false)

  const isCredit = transaction.type === 'credit'
  const isDebit = transaction.type === 'debit'
  const isAdjustment = transaction.referenceType === 'manual'

  // New rows: type is 'credit' or 'debit', referenceType:'manual' identifies manual adjustments.
  // Legacy rows (written before the fix): type may be 'adjustment' with unknown direction.
  // For legacy rows: show ₹amount in paused color with no sign — direction is unrecoverable
  // without the adjacent row's balanceAfter, which we don't have here.
  const signedAmount = isCredit
    ? `+₹${transaction.amount.toLocaleString('en-IN')}`
    : isDebit
    ? `-₹${transaction.amount.toLocaleString('en-IN')}`
    : `₹${transaction.amount.toLocaleString('en-IN')}` // legacy 'adjustment' rows — no sign

  const amountColor = isCredit ? 'text-free' : isDebit ? 'text-busy' : 'text-paused'

  // Icon: gear for manual adjustments (referenceType), arrows for direction (type).
  // Keep these two concerns separate — a manual adjustment IS a credit or debit,
  // so isAdjustment and isCredit/isDebit can both be true simultaneously.
  const icon = isAdjustment ? (
    // Manual adjustment — gear icon regardless of direction
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-paused">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ) : isCredit ? (
    // Credit — arrow up
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-free">
      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
    </svg>
  ) : isDebit ? (
    // Debit — arrow down
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-busy">
      <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
    </svg>
  ) : (
    // Defensive fallback — dead code after v6 migration, kept as safety net
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-paused">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )

  const iconBg = isAdjustment
    ? 'bg-paused/12 border-paused/20'
    : isCredit
    ? 'bg-free/12 border-free/20'
    : isDebit
    ? 'bg-busy/12 border-busy/20'
    : 'bg-paused/12 border-paused/20'

  const refLabel =
    transaction.referenceType === 'topup'
      ? `Top-up${transaction.paymentMode ? ` · ${transaction.paymentMode.toUpperCase()}` : ''}`
      : transaction.referenceType === 'session'
      ? 'Session debit'
      : transaction.referenceType === 'manual'
      ? 'Manual adjustment'
      : transaction.referenceType === 'refund'
      ? 'Refund'
      : transaction.referenceType ?? ''

  const whatsappUrl =
    customerPhone && expanded
      ? (() => {
          const digits = customerPhone.replace(/^\+/, '')
          const typeLabel = isCredit ? 'Top-up' : isAdjustment ? 'Adjustment' : 'Debit'
          const text = `*${typeLabel} Receipt*\n\nAmount: ₹${transaction.amount.toLocaleString('en-IN')}\nBalance: ₹${transaction.balanceAfter.toLocaleString('en-IN')}${transaction.notes ? `\nNote: ${transaction.notes}` : ''}`
          return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
        })()
      : null

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full bg-bg-card border border-border rounded-2xl px-4 py-3 text-left"
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${iconBg}`}>
          {icon}
        </div>

        {/* Middle */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text truncate">{refLabel}</p>
          <p className="text-[11px] text-text-faint">
            {formatDistanceToNow(transaction.createdAt, { addSuffix: true })}
          </p>
        </div>

        {/* Amount + balance */}
        <div className="text-right shrink-0">
          <p className={`text-[14px] font-bold ${amountColor}`}>{signedAmount}</p>
          <p className="text-[11px] text-text-faint">
            bal ₹{transaction.balanceAfter.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          {transaction.notes && (
            <p className="text-[13px] text-text-dim">{transaction.notes}</p>
          )}
          <p className="text-[11px] text-text-faint font-mono">
            {new Date(transaction.createdAt).toLocaleString('en-IN')}
          </p>
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#25D366] font-semibold min-h-[36px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.55 4.116 1.516 5.845L.057 23.25a.5.5 0 0 0 .614.65l5.595-1.464A11.938 11.938 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.73 9.73 0 0 1-4.966-1.359l-.356-.212-3.69.968.982-3.594-.232-.37A9.712 9.712 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
              </svg>
              Send WhatsApp receipt
            </a>
          )}
        </div>
      )}
    </button>
  )
}
