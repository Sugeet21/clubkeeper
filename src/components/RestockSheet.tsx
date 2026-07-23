import { useEffect, useState } from 'react'
import { recordStockPurchase } from '../db/queries'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { CanteenItem } from '../types'

interface RestockSheetProps {
  open: boolean
  item: CanteenItem | null
  piggyBalance: number
  onCancel: () => void
  onSaved: (input: { quantityAdded: number; cost: number; source: 'piggy' | 'other' }) => void
}

/**
 * Bottom-sheet form for restocking a single canteen item.
 * Writes a StockPurchase row + (when item.stockEnabled) increments
 * currentStock — atomically via recordStockPurchase() in queries.ts.
 *
 * The "Piggy" payment source is disabled when cost > piggyBalance.
 * On items with stockEnabled=false, a caveat warns the owner that
 * stock will not be tracked.
 */
export function RestockSheet({
  open,
  item,
  piggyBalance,
  onCancel,
  onSaved,
}: RestockSheetProps) {
  const [quantity, setQuantity] = useState(1)
  const [cost, setCost] = useState(0)
  const [source, setSource] = useState<'piggy' | 'other'>('piggy')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on every open
  useEffect(() => {
    if (!open) return
    setQuantity(1)
    setCost(0)
    setSource('piggy')
    setNotes('')
    setSubmitting(false)
    setError(null)
  }, [open])

  // Lock body scroll while open (#177 — shared reference-counted lock).
  useBodyScrollLock(open)

  if (!open || !item || item.id === undefined) return null

  const piggyDisabled = cost > piggyBalance
  // If piggy got disabled while it was selected, snap to 'other' (visually)
  const effectiveSource: 'piggy' | 'other' =
    source === 'piggy' && piggyDisabled ? 'other' : source

  const stockEnabled = item.stockEnabled === true
  const currentStock = item.currentStock ?? 0
  const nextStock = currentStock + quantity
  const nextPiggy = piggyBalance - cost
  const canConfirm = !submitting && quantity >= 1 && cost >= 0

  async function handleConfirm() {
    if (!canConfirm) return
    setSubmitting(true)
    setError(null)
    try {
      await recordStockPurchase({
        canteenItemId: item!.id!,
        quantityAdded: quantity,
        cost,
        source: effectiveSource,
        notes: notes.trim() || undefined,
      })
      onSaved({
        quantityAdded: quantity,
        cost,
        source: effectiveSource,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record restock.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={() => !submitting && onCancel()}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] bg-bg-card rounded-t-3xl border-t border-border max-h-[92vh] flex flex-col"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
            Restock
          </p>
          <p className="text-text text-base font-semibold mt-0.5 truncate">{item.name}</p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
          {/* Quantity */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Quantity added
            </label>
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-11 h-11 flex items-center justify-center bg-bg border border-border rounded-xl text-text-dim disabled:opacity-30"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={quantity === 0 ? '' : quantity}
                placeholder="1"
                onChange={(e) => {
                  const v = e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value)))
                  setQuantity(v)
                }}
                className="flex-1 min-w-0 px-3 py-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono text-right tabular-nums focus:border-accent outline-none"
              />
              <button
                onClick={() => setQuantity((q) => q + 1)}
                className="w-11 h-11 flex items-center justify-center bg-accent/15 border border-accent/30 rounded-xl text-accent"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          </div>

          {/* Cost */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Cost paid (₹)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={cost === 0 ? '' : cost}
              placeholder="0"
              onChange={(e) => {
                const v = e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value)))
                setCost(v)
              }}
              className="w-full mt-1.5 px-4 py-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono text-right tabular-nums focus:border-accent outline-none min-h-[44px]"
            />
          </div>

          {/* Source */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Paid from
            </label>
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => !piggyDisabled && setSource('piggy')}
                disabled={piggyDisabled}
                className={
                  effectiveSource === 'piggy' && !piggyDisabled
                    ? 'flex-1 min-h-[44px] px-3 rounded-xl bg-accent/15 border border-accent/40 text-accent text-[13px] font-semibold'
                    : 'flex-1 min-h-[44px] px-3 rounded-xl bg-bg border border-border text-text-dim text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed'
                }
              >
                Piggy
                {piggyDisabled && (
                  <span className="block text-[10px] text-text-faint mt-0.5">
                    not enough
                  </span>
                )}
              </button>
              <button
                onClick={() => setSource('other')}
                className={
                  effectiveSource === 'other'
                    ? 'flex-1 min-h-[44px] px-3 rounded-xl bg-accent/15 border border-accent/40 text-accent text-[13px] font-semibold'
                    : 'flex-1 min-h-[44px] px-3 rounded-xl bg-bg border border-border text-text-dim text-[13px] font-semibold'
                }
              >
                Other
              </button>
            </div>
          </div>

          {/* Notes (collapsed-ish, but always shown — small) */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              maxLength={200}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. ordered from Reliance Smart"
              className="w-full mt-1.5 px-4 py-3 bg-bg border border-border rounded-xl text-text text-[13px] focus:border-accent outline-none placeholder:text-text-faint min-h-[44px]"
            />
          </div>

          {/* Live preview */}
          <div className="bg-bg border border-border rounded-2xl px-4 py-3 space-y-1">
            <p className="text-[11px] text-text-faint">After this:</p>
            {stockEnabled ? (
              <p className="text-[13px] text-text font-mono tabular-nums">
                Stock {currentStock} + {quantity} ={' '}
                <span className="text-text font-bold">{nextStock}</span>
              </p>
            ) : (
              <p className="text-[12px] text-paused">
                ⚠ Stock tracking is disabled — currentStock won't change.
              </p>
            )}
            {effectiveSource === 'piggy' && (
              <p className="text-[13px] text-text font-mono tabular-nums">
                Piggy ₹{piggyBalance.toLocaleString('en-IN')} − ₹
                {cost.toLocaleString('en-IN')} ={' '}
                <span className="text-text font-bold">
                  ₹{nextPiggy.toLocaleString('en-IN')}
                </span>
              </p>
            )}
          </div>

          {error && (
            <p className="text-busy text-[13px] text-center">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 pt-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={
              canConfirm
                ? 'w-full bg-accent text-bg font-bold py-4 rounded-2xl min-h-[48px]'
                : 'w-full bg-bg text-text-faint border border-border font-semibold py-4 rounded-2xl min-h-[48px] opacity-50 cursor-not-allowed'
            }
          >
            {submitting ? 'Saving…' : 'Confirm restock'}
          </button>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full bg-bg-card text-text-dim border border-border py-3 rounded-2xl min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
