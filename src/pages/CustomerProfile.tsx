import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatDistanceToNow } from 'date-fns'
import Dexie from 'dexie'
import { db } from '../db/database'
import type { WalletTransaction } from '../types/walletTransaction'
import { customerDisplayName, formattedPhone } from '../lib/customerDisplay'
import ManualAdjustmentModal from '../components/wallet/ManualAdjustmentModal'
import EditCustomerModal from '../components/wallet/EditCustomerModal'
import TransactionRow from '../components/wallet/TransactionRow'
import { useSettings } from '../hooks/useLiveData'
import { resolveCoinConfig, formatCoins } from '../lib/coins'
import { applyExpiryForCustomer, daysUntilExpiry } from '../lib/coinExpiry'

type HistoryTab = 'wallet' | 'coins'

export default function CustomerProfile() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const settings = useSettings()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [historyTab, setHistoryTab] = useState<HistoryTab>('wallet')

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

  const coinConfig = resolveCoinConfig(settings ?? {})

  // Run per-customer expiry on mount (debounced inside applyExpiryForCustomer — at most once/hr)
  useEffect(() => {
    if (!customer) return
    applyExpiryForCustomer(customer.id).catch(() => {/* non-critical */})
  }, [customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute days until next expiry for the coin balance badge
  const coinTxs = (transactions ?? []).filter(
    (t) => (t.balanceType ?? 'wallet') === 'coins',
  )
  const expiryDays = daysUntilExpiry(coinTxs, coinConfig.coinExpiryDays, Date.now())

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

  const displayName = customerDisplayName(customer)
  const phoneDisplay = formattedPhone(customer)

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

          {/* Tappable name+phone block — entire area opens EditCustomerModal */}
          <button
            onClick={() => setEditOpen(true)}
            className="flex-1 min-w-0 min-h-[44px] flex flex-col justify-center text-left"
            aria-label="Edit customer"
          >
            <div className="flex items-center gap-1.5">
              <h1 className="text-[20px] font-bold text-text truncate">{displayName}</h1>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-faint shrink-0">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            {phoneDisplay ? (
              <span className="text-[13px] text-text-dim font-mono mt-0.5">{phoneDisplay}</span>
            ) : customer.walkInCode ? (
              <span className="text-[11px] font-mono text-text-faint mt-0.5">{customer.walkInCode}</span>
            ) : null}
          </button>
        </div>

        {/* Balance card */}
        <div className="bg-bg-card border border-border rounded-2xl p-5 mb-4">
          {coinConfig.coinsEnabled ? (
            <div className="flex gap-4">
              <div className="flex-1">
                <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1">
                  Wallet
                </p>
                <p className="text-[28px] font-bold text-accent font-mono leading-tight">
                  ₹{customer.walletBalance.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="w-px bg-border" />
              <div className="flex-1">
                <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1">
                  ClubCoins
                </p>
                <p className="text-[28px] font-bold text-amber-400 font-mono leading-tight">
                  {formatCoins(customer.coinBalance ?? 0)}
                </p>
                {expiryDays !== null && coinConfig.coinExpiryDays && (
                  <p className={`text-[11px] mt-0.5 font-semibold ${expiryDays <= 7 ? 'text-amber-400' : 'text-text-faint'}`}>
                    Expires in {expiryDays}d
                  </p>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1">
                Wallet Balance
              </p>
              <p className="text-[36px] font-bold text-accent font-mono leading-tight">
                ₹{customer.walletBalance.toLocaleString('en-IN')}
              </p>
            </>
          )}
          {transactions && transactions.length > 0 && (
            <p className="text-[12px] text-text-faint mt-2">
              Last activity {formatDistanceToNow(customer.lastVisitAt ?? customer.createdAt, { addSuffix: true })}
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
        {coinConfig.coinsEnabled ? (
          <div className="flex gap-1 mb-4 bg-bg-card border border-border rounded-xl p-1">
            <button
              onClick={() => setHistoryTab('wallet')}
              className={`flex-1 min-h-[36px] rounded-lg text-[13px] font-semibold transition-colors ${
                historyTab === 'wallet' ? 'bg-accent text-bg' : 'text-text-dim'
              }`}
            >
              Wallet History
            </button>
            <button
              onClick={() => setHistoryTab('coins')}
              className={`flex-1 min-h-[36px] rounded-lg text-[13px] font-semibold transition-colors ${
                historyTab === 'coins' ? 'bg-amber-500 text-bg' : 'text-text-dim'
              }`}
            >
              🪙 Coin History
            </button>
          </div>
        ) : (
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-3">
            Transaction History
          </p>
        )}

        {(() => {
          const filtered = historyTab === 'coins'
            ? (transactions ?? []).filter((t) => (t.balanceType ?? 'wallet') === 'coins')
            : (transactions ?? []).filter((t) => (t.balanceType ?? 'wallet') === 'wallet')
          const list = coinConfig.coinsEnabled ? filtered : (transactions ?? [])

          if (list.length === 0) return (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <p className="text-text-dim text-sm">
                {historyTab === 'coins' ? 'No coin transactions yet' : 'No transactions yet'}
              </p>
            </div>
          )
          return (
            <div className="space-y-2">
              {list.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  customerPhone={customer.phone}
                  customerName={customer.name}
                />
              ))}
            </div>
          )
        })()}
      </div>

      {adjustOpen && (
        <ManualAdjustmentModal
          customer={customer}
          onClose={() => setAdjustOpen(false)}
        />
      )}

      {editOpen && (
        <EditCustomerModal
          customer={customer}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  )
}
