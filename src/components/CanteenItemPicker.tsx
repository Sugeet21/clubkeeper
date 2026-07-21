import { useMemo, useState } from 'react'
import { normalizeName } from '../lib/canteenMatch'
import { getEffectivePrice, isInPeakWindow, type PeakConfig } from '../lib/peakPricing'
import type { CanteenItem } from '../types'

// ─── Shared canteen item picker (#167) ────────────────────────────────────────
// The searchable tap-grid extracted from AddItemBottomSheet's 20 Jul redesign,
// so QuickSale + BackEntry stop hand-rolling their own (drift source — the
// grid/search/×N badge upgrade never reached them). Serves the three
// "tap-to-add" surfaces; the CALLER owns what a tap does (atomic add / cart add
// / draft add) via onSelect, and what the ×N badge counts via getBadgeCount.
//
// NOT used by the Canteen management page — those cards carry edit/delete/
// restock actions, not "add"; Canteen uses a plain search box over its own list
// (see Canteen.tsx). Trying to unify that too would need a prop per action and
// defeat the point.
//
// Out-of-stock behaviour is LOCKED to "block the tap everywhere" (owner decision
// 21 Jul) — dimmed + disabled, no toast. Consistent across all three surfaces.

interface CanteenItemPickerProps {
  items: CanteenItem[]
  onSelect: (item: CanteenItem) => void
  // Optional ×N badge (session qty / cart qty / draft qty). Omit → no badge.
  getBadgeCount?: (item: CanteenItem) => number
  peakNow: Date
  peakCfg: PeakConfig
  // When false, the tile shows the plain defaultPrice and never a peak tag —
  // used by Back Entry, which logs a HISTORICAL session where today's peak
  // window is irrelevant. Default true (live add-to-session / add-to-cart).
  usePeakPricing?: boolean
  // Global disable (e.g. an in-flight submit). Out-of-stock items are always
  // disabled regardless.
  disabled?: boolean
  // Show the search box once the list is at least this long. Matches the
  // AddItemBottomSheet default.
  searchThreshold?: number
  // Optional label above the grid (e.g. "Canteen items"). Omit → no label.
  label?: string
  // Render a live "N left" / "Out of stock" pill on each stock-tracked tile.
  // QuickSale wants it (walk-in cashier); the in-session/back-entry surfaces
  // don't (already show "Out of stock" and stock is enforced at add-time).
  showStock?: boolean
}

export function CanteenItemPicker({
  items,
  onSelect,
  getBadgeCount,
  peakNow,
  peakCfg,
  usePeakPricing = true,
  disabled = false,
  searchThreshold = 6,
  label,
  showStock = false,
}: CanteenItemPickerProps) {
  const [search, setSearch] = useState('')
  const peakActive = usePeakPricing && isInPeakWindow(peakNow, peakCfg)

  const filtered = useMemo(() => {
    const q = normalizeName(search)
    if (!q) return items
    return items.filter((ci) => normalizeName(ci.name).includes(q))
  }, [items, search])

  if (items.length === 0) return null

  return (
    <div>
      {label && (
        <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-2">
          {label}
        </p>
      )}

      {items.length > searchThreshold && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items…"
          aria-label="Search canteen items"
          className="w-full bg-bg border border-border rounded-xl px-4 py-2.5 mb-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
        />
      )}

      {filtered.length === 0 ? (
        <p className="text-[13px] text-text-dim py-3 text-center">
          No items match “{search.trim()}”.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {filtered.map((ci) => {
            const stockTracked = ci.stockEnabled === true
            const stock = ci.currentStock ?? 0
            const outOfStock = stockTracked && stock === 0
            const effectivePrice = usePeakPricing ? getEffectivePrice(ci, peakNow, peakCfg) : ci.defaultPrice
            const showPeakTag = peakActive && typeof ci.peakPrice === 'number' && ci.peakPrice > 0
            const badge = getBadgeCount?.(ci) ?? 0
            return (
              <button
                key={ci.id}
                type="button"
                disabled={outOfStock || disabled}
                onClick={() => onSelect(ci)}
                className={`relative min-h-[60px] px-3 py-2 border rounded-2xl text-sm flex flex-col items-center justify-center text-center transition-colors ${
                  outOfStock
                    ? 'bg-bg-card border-border text-text-faint opacity-50 cursor-not-allowed'
                    : badge > 0
                      ? 'bg-accent/10 border-accent/50 text-text active:scale-95 transition-transform'
                      : 'bg-bg-card border-border text-text active:scale-95 transition-transform'
                }`}
              >
                {badge > 0 && (
                  <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-[10px] font-mono font-bold flex items-center justify-center leading-none">
                    ×{badge}
                  </span>
                )}
                <span className="font-medium leading-tight line-clamp-2">{ci.name}</span>
                <span className="mt-0.5 inline-flex items-center gap-1">
                  <span className={`font-mono text-xs ${showPeakTag ? 'text-paused font-bold' : 'text-text-dim'}`}>
                    ₹{effectivePrice.toLocaleString('en-IN')}
                  </span>
                  {showPeakTag && (
                    <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1 py-0.5 rounded-full bg-paused/15 text-paused leading-none">
                      Peak
                    </span>
                  )}
                </span>
                {/* Stock pill (QuickSale) — live remaining count. Falls back to
                    the plain "Out of stock" line when showStock is off. */}
                {showStock && stockTracked ? (
                  <span
                    className={`mt-1 text-[9px] font-mono px-1.5 py-0.5 rounded-full leading-none ${
                      outOfStock ? 'bg-busy/15 text-busy font-bold' : 'bg-bg text-text-faint'
                    }`}
                  >
                    {outOfStock ? 'Out of stock' : `${stock} left`}
                  </span>
                ) : (
                  outOfStock && (
                    <span className="text-[10px] font-mono text-busy leading-none mt-0.5">
                      Out of stock
                    </span>
                  )
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
