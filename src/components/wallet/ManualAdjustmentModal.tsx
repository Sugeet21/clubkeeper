import { useEffect, useState } from 'react'
import { useCustomerStore } from '../../store/customerStore'
import { useToastStore } from '../../store/toastStore'
import type { Customer } from '../../types/customer'

interface Props {
  customer: Customer
  onClose: () => void
}

export default function ManualAdjustmentModal({ customer, onClose }: Props) {
  const { applyManualAdjustment } = useCustomerStore()
  const { show: showToast } = useToastStore()

  const [adjType, setAdjType] = useState<'credit' | 'debit'>('credit')
  const [amountStr, setAmountStr] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const amount = parseInt(amountStr, 10) || 0
  const canApply = !saving && amount > 0 && notes.trim().length >= 3

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleApply() {
    if (!canApply) return
    setSaving(true)
    try {
      await applyManualAdjustment({
        customerId: customer.id,
        type: adjType,
        amount,
        notes: notes.trim(),
      })
      showToast({ message: 'Adjustment applied', type: 'success' })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply adjustment'
      showToast({ message: msg, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const displayName = customer.name ?? customer.walkInCode ?? 'Customer'

  return (
    <>
      {/* Scrim — Pattern M1: independent fixed layer z-40 */}
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
      />
      {/* Sheet — independent fixed layer z-50 */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl p-5 pb-safe">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

        <h2 className="text-[18px] font-bold text-text mb-1">Manual Adjustment</h2>
        <p className="text-[13px] text-text-dim mb-5">{displayName}</p>

        {/* Credit / Debit toggle */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          <button
            onClick={() => setAdjType('credit')}
            className={`min-h-[48px] rounded-2xl text-[14px] font-semibold border transition-colors ${
              adjType === 'credit'
                ? 'bg-free/15 border-free/30 text-free'
                : 'bg-bg border-border text-text-dim'
            }`}
          >
            Credit
          </button>
          <button
            onClick={() => setAdjType('debit')}
            className={`min-h-[48px] rounded-2xl text-[14px] font-semibold border transition-colors ${
              adjType === 'debit'
                ? 'bg-busy/15 border-busy/30 text-busy'
                : 'bg-bg border-border text-text-dim'
            }`}
          >
            Debit
          </button>
        </div>

        {/* Amount */}
        <div className="mb-4">
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
            Amount (₹)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0"
            className="w-full px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
            autoFocus
          />
          {adjType === 'debit' && amount > customer.walletBalance && (
            <p className="text-[13px] text-busy mt-1.5">
              Exceeds balance (₹{customer.walletBalance.toLocaleString('en-IN')})
            </p>
          )}
        </div>

        {/* Notes (mandatory) */}
        <div className="mb-5">
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
            Reason <span className="normal-case tracking-normal font-normal">(required)</span>
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for adjustment"
            className="w-full px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 min-h-[54px] bg-bg border border-border text-text-dim font-semibold text-[15px] rounded-2xl"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="flex-1 min-h-[54px] bg-accent text-bg font-bold text-[15px] rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              'Apply'
            )}
          </button>
        </div>
      </div>
    </>
  )
}
