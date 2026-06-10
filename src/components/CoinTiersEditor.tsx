import { useState } from 'react'
import type { CoinTier } from '../types'

interface Props {
  tiers: CoinTier[]
  onChange: (tiers: CoinTier[]) => void
}

interface TierDraft {
  minAmountStr: string
  coinsStr: string
}

function emptyDraft(): TierDraft {
  return { minAmountStr: '', coinsStr: '' }
}

export function CoinTiersEditor({ tiers, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<TierDraft>(emptyDraft())
  const [draftError, setDraftError] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  function validateDraft(d: TierDraft, excludeIndex?: number): string | null {
    const minAmount = parseInt(d.minAmountStr, 10)
    const coins = parseInt(d.coinsStr, 10)
    if (!Number.isInteger(minAmount) || minAmount < 50 || minAmount > 50000) {
      return 'Min amount must be between ₹50 and ₹50,000'
    }
    if (!Number.isInteger(coins) || coins < 1 || coins > 5000) {
      return 'Coins must be between 1 and 5,000'
    }
    const duplicate = tiers.some(
      (t, i) => t.minAmount === minAmount && i !== excludeIndex,
    )
    if (duplicate) return `A tier for ₹${minAmount.toLocaleString('en-IN')} already exists`
    return null
  }

  function commitAdd() {
    const err = validateDraft(draft)
    if (err) { setDraftError(err); return }
    const minAmount = parseInt(draft.minAmountStr, 10)
    const coins = parseInt(draft.coinsStr, 10)
    const next = [...tiers, { minAmount, coins }]
      .sort((a, b) => a.minAmount - b.minAmount)
    if (next.length > 8) { setDraftError('Maximum 8 tiers allowed'); return }
    onChange(next)
    setDraft(emptyDraft())
    setDraftError(null)
    setAdding(false)
  }

  function commitEdit(index: number) {
    const err = validateDraft(draft, index)
    if (err) { setDraftError(err); return }
    const minAmount = parseInt(draft.minAmountStr, 10)
    const coins = parseInt(draft.coinsStr, 10)
    const next = tiers.map((t, i) => i === index ? { minAmount, coins } : t)
      .sort((a, b) => a.minAmount - b.minAmount)
    onChange(next)
    setEditingIndex(null)
    setDraft(emptyDraft())
    setDraftError(null)
  }

  function removeTier(index: number) {
    onChange(tiers.filter((_, i) => i !== index))
  }

  function startEdit(index: number) {
    const t = tiers[index]
    setDraft({ minAmountStr: String(t.minAmount), coinsStr: String(t.coins) })
    setDraftError(null)
    setEditingIndex(index)
    setAdding(false)
  }

  function cancelEdit() {
    setEditingIndex(null)
    setDraft(emptyDraft())
    setDraftError(null)
  }

  return (
    <div className="space-y-2">
      {tiers.map((tier, i) => (
        <div key={tier.minAmount}>
          {editingIndex === i ? (
            <TierInputRow
              draft={draft}
              onChange={(d) => { setDraft(d); setDraftError(null) }}
              error={draftError}
              onConfirm={() => commitEdit(i)}
              onCancel={cancelEdit}
            />
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-bg rounded-xl border border-border">
              <span className="text-[13px] text-text flex-1">
                ₹{tier.minAmount.toLocaleString('en-IN')} → <span className="text-amber-400 font-semibold">{tier.coins.toLocaleString('en-IN')} coins</span>
              </span>
              <button
                onClick={() => startEdit(i)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-text-dim"
                aria-label="Edit tier"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                onClick={() => removeTier(i)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-text-faint"
                aria-label="Remove tier"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}

      {adding && editingIndex === null && (
        <TierInputRow
          draft={draft}
          onChange={(d) => { setDraft(d); setDraftError(null) }}
          error={draftError}
          onConfirm={commitAdd}
          onCancel={() => { setAdding(false); setDraft(emptyDraft()); setDraftError(null) }}
        />
      )}

      {!adding && editingIndex === null && tiers.length < 8 && (
        <button
          onClick={() => { setAdding(true); setDraft(emptyDraft()) }}
          className="w-full min-h-[40px] flex items-center gap-1.5 text-accent text-[13px] font-semibold px-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add tier
        </button>
      )}
    </div>
  )
}

interface RowProps {
  draft: TierDraft
  onChange: (d: TierDraft) => void
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}

function TierInputRow({ draft, onChange, error, onConfirm, onCancel }: RowProps) {
  return (
    <div className="bg-bg rounded-xl border border-accent/40 px-3 py-2.5 space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <p className="text-[10px] text-text-faint mb-1">Min topup (₹)</p>
          <input
            type="number"
            inputMode="numeric"
            value={draft.minAmountStr}
            onChange={(e) => onChange({ ...draft, minAmountStr: e.target.value })}
            placeholder="e.g. 500"
            className="w-full px-2.5 py-2 bg-bg-card border border-border rounded-xl text-text text-[14px] outline-none focus:border-accent"
          />
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-text-faint mb-1">Coins earned</p>
          <input
            type="number"
            inputMode="numeric"
            value={draft.coinsStr}
            onChange={(e) => onChange({ ...draft, coinsStr: e.target.value })}
            placeholder="e.g. 50"
            className="w-full px-2.5 py-2 bg-bg-card border border-border rounded-xl text-text text-[14px] outline-none focus:border-accent"
          />
        </div>
      </div>
      {error && <p className="text-busy text-[12px]">{error}</p>}
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={onConfirm}
          className="flex-1 min-h-[36px] bg-accent text-bg text-[13px] font-bold rounded-xl"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="min-h-[36px] px-4 text-text-dim text-[13px] rounded-xl border border-border"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
