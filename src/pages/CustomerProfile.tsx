import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatDistanceToNow } from 'date-fns'
import { db } from '../db/database'
import type { WalletTransaction } from '../types/walletTransaction'
import ManualAdjustmentModal from '../components/wallet/ManualAdjustmentModal'
import EditPhoneModal from '../components/wallet/EditPhoneModal'
import TransactionRow from '../components/wallet/TransactionRow'

export default function CustomerProfile() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [editPhoneOpen, setEditPhoneOpen] = useState(false)

  const customer = useLiveQuery(
    () => (customerId ? db.customers.get(customerId) : undefined),
    [customerId],
  )

  const transactions = useLiveQuery(
    () =>
      customerId
        ? db.walletTransactions
            .where('[customerId+createdAt]')
            .between([customerId, Dexie.minKey], [customerId, Dexie.maxKey])
            .reverse()
            .toArray()
        : Promise.resolve([] as WalletTransaction[]),
    [customerId],
    [] as WalletTransaction[],
  )

  if (customer === undefined) {
    return (
      <div className="bg-bg min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="bg-bg min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-text-dim text-sm">Customer not found.</p>
        <button onClick={() => navigate('/wallet')} className="text-accent text-sm font-semibold">
          Back to Wallet
        </button>
      </div>
    )
  }

  const displayName = customer.name ?? customer.walkInCode ?? 'Customer'
  const phoneDisplay = customer.phone
    ? `+91 ${customer.phone.slice(3, 8)} ${customer.phone.slice(8)}`
    : null

  return (
    <div className="bg-bg min-h-screen pb-24">
      <div className="pt-safe px-5">
        {/* Header */}
        <div className="flex items-center gap-3 pt-4 pb-4">
          <button
            onClick={() => navigate('/wallet')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-text truncate">{displayName}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              {phoneDisplay ? (
                <>
                  <span className="text-[13px] text-text-dim font-mono">{phoneDisplay}</span>
                  <button
                    onClick={() => setEditPhoneOpen(true)}
                    className="min-w-[28px] min-h-[28px] flex items-center justify-center text-text-faint"
                    aria-label="Edit phone"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  {customer.walkInCode && (
                    <span className="text-[11px] font-mono text-text-faint bg-bg-card border border-border px-2 py-0.5 rounded-md">
                      {customer.walkInCode}
                    </span>
                  )}
                  <button
                    onClick={() => setEditPhoneOpen(true)}
                    className="text-[12px] text-accent underline underline-offset-2 min-h-[28px] flex items-center"
                  >
                    + Add phone
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Balance card */}
        <div className="bg-bg-card border border-border rounded-2xl p-5 mb-4">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1">
            Wallet Balance
          </p>
          <p className="text-[36px] font-bold text-accent font-mono leading-tight">
            ₹{customer.walletBalance.toLocaleString('en-IN')}
          </p>
          {transactions && transactions.length > 0 && (
            <p className="text-[12px] text-text-faint mt-1">
              Last activity {formatDistanceToNow(customer.lastVisitAt, { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => navigate(`/wallet/topup/${customer.id}`)}
            className="min-h-[54px] bg-accent text-bg font-bold text-[14px] rounded-2xl flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Credit
          </button>
          <button
            onClick={() => setAdjustOpen(true)}
            className="min-h-[54px] bg-bg-card border border-border text-text font-semibold text-[14px] rounded-2xl flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Adjust
          </button>
        </div>

        {/* Transaction history */}
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-3">
          Transaction History
        </p>

        {(!transactions || transactions.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-text-dim text-sm">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                customerPhone={customer.phone}
                customerName={customer.name}
              />
            ))}
          </div>
        )}
      </div>

      {adjustOpen && (
        <ManualAdjustmentModal
          customer={customer}
          onClose={() => setAdjustOpen(false)}
        />
      )}

      {editPhoneOpen && (
        <EditPhoneModal
          customer={customer}
          onClose={() => setEditPhoneOpen(false)}
        />
      )}
    </div>
  )
}

// Dexie needed for minKey/maxKey in the compound index query
import Dexie from 'dexie'
