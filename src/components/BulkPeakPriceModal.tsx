import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { bulkSetCanteenItemPeakPrices } from '../db/queries'
import { useToastStore } from '../store/toastStore'
import type { CanteenItem } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  items: CanteenItem[]
}

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

export function BulkPeakPriceModal({ open, onClose, items }: Props) {
  const showToast = useToastStore((s) => s.show)

  // Local draft: id → string ('' = clear). Initialised from stored peakPrice
  // every time the modal opens, so reopening shows current persisted state.
  const [draft, setDraft] = useState<Map<number, string>>(new Map())
  const [errors, setErrors] = useState<Map<number, string>>(new Map())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const next = new Map<number, string>()
    for (const item of items) {
      if (item.id === undefined) continue
      next.set(item.id, typeof item.peakPrice === 'number' ? String(item.peakPrice) : '')
    }
    setDraft(next)
    setErrors(new Map())
  }, [open, items])

  const sortedItems = useMemo(
    () => items.filter((i) => i.id !== undefined && i.isActive),
    [items],
  )

  function handleChange(id: number, value: string) {
    setDraft((prev) => {
      const next = new Map(prev)
      next.set(id, value)
      return next
    })
    if (errors.has(id)) {
      setErrors((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
    }
  }

  function validate(): boolean {
    const next = new Map<number, string>()
    for (const item of sortedItems) {
      if (item.id === undefined) continue
      const raw = (draft.get(item.id) ?? '').trim()
      if (raw === '') continue
      const num = Number(raw)
      if (!Number.isInteger(num) || num < 1 || num > 9999) {
        next.set(item.id, 'Whole number 1–9999')
      }
    }
    setErrors(next)
    return next.size === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const patches: { id: number; peakPrice?: number }[] = []
      for (const item of sortedItems) {
        if (item.id === undefined) continue
        const raw = (draft.get(item.id) ?? '').trim()
        const next = raw === '' ? undefined : Number(raw)
        const current = item.peakPrice
        // Only patch rows that actually changed.
        if (next !== current) {
          patches.push({ id: item.id, peakPrice: next })
        }
      }
      if (patches.length === 0) {
        showToast('No changes to save', 'info')
        onClose()
        return
      }
      await bulkSetCanteenItemPeakPrices(patches)
      showToast(`Updated peak prices on ${patches.length} item${patches.length === 1 ? '' : 's'}`, 'success')
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save peak prices', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Set peak prices">
      <div className="flex flex-col gap-4">
        <p className="text-text-dim text-[13px] leading-snug">
          Set peak prices for all canteen items at once. Leave a row blank to use only the regular price for that item.
        </p>

        {sortedItems.length === 0 ? (
          <div className="bg-bg border border-border rounded-2xl px-4 py-6 text-center">
            <p className="text-text-faint text-sm">No canteen items yet.</p>
          </div>
        ) : (
          <div className="bg-bg border border-border rounded-2xl overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_auto_120px] gap-3 px-4 py-2.5 border-b border-border bg-bg-card">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
                Item
              </p>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint text-right">
                Regular
              </p>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint text-right">
                Peak (₹)
              </p>
            </div>
            <div className="max-h-[55vh] overflow-y-auto overscroll-contain divide-y divide-border">
              {sortedItems.map((item) => {
                const id = item.id!
                const value = draft.get(id) ?? ''
                const err = errors.get(id)
                return (
                  <div key={id} className="grid grid-cols-[1fr_auto_120px] gap-3 px-4 py-3 items-center">
                    <p className="text-[14px] text-text truncate">{item.name}</p>
                    <p className="text-[13px] text-text-dim font-mono tabular-nums text-right whitespace-nowrap">
                      {formatINR(item.defaultPrice)}
                    </p>
                    <div className="flex flex-col items-end">
                      <input
                        type="number"
                        value={value}
                        onChange={(e) => handleChange(id, e.target.value)}
                        placeholder="—"
                        min={1}
                        max={9999}
                        inputMode="numeric"
                        aria-label={`Peak price for ${item.name}`}
                        className={`w-full min-h-[40px] px-3 bg-bg-card border rounded-xl text-text text-[14px] text-right font-mono tabular-nums focus:border-accent outline-none placeholder:text-text-faint ${
                          err ? 'border-busy' : 'border-border'
                        }`}
                      />
                      {err && <p className="text-busy text-[10px] mt-0.5 leading-tight">{err}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || sortedItems.length === 0}
            className="min-h-[52px] bg-accent text-bg font-bold rounded-2xl w-full disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save all'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] bg-bg-card text-text-dim border border-border rounded-2xl w-full"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
