// #176 — the ONE 4-chip category selector. Used by CanteenItemFormModal (add/edit, Chunk 2a)
// and the bulk-tag screen (Chunk 2b) so the chips are identical everywhere — one source of
// truth, per the owner's ask. Value is CanteenItemCategory | undefined; undefined = uncategorised
// (→ NULL → sorts LAST on the restock surface). Tapping the already-selected chip clears it back
// to undefined, so an owner can un-tag without a separate "clear" affordance.
//
// Ordering of the chips follows CATEGORY_LABELS (= CATEGORY_ORDER = the shop-run order), so the
// picker reads top-to-bottom the same way the printed sheet groups. Never re-hardcode the list
// here — it comes from CATEGORY_LABELS so adding a category later touches one place.

import { CATEGORY_LABELS } from '../types'
import type { CanteenItemCategory } from '../types'

interface Props {
  value: CanteenItemCategory | undefined
  onChange: (next: CanteenItemCategory | undefined) => void
  /** Compact chips for dense list rows (bulk-tag screen). Default is the roomier form size. */
  dense?: boolean
  'aria-label'?: string
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CanteenItemCategory[]

export function CategoryPicker({ value, onChange, dense = false, 'aria-label': ariaLabel }: Props) {
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? 'Category'}
      className={dense ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap gap-2'}
    >
      {CATEGORIES.map((cat) => {
        const selected = value === cat
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={selected}
            // Tapping the selected chip clears the category (→ undefined → sorts last).
            onClick={() => onChange(selected ? undefined : cat)}
            className={[
              dense ? 'min-h-[36px] px-3 text-[13px]' : 'min-h-[44px] px-4 text-[14px]',
              'rounded-full font-medium border transition-colors',
              selected
                ? 'bg-accent text-bg border-accent'
                : 'bg-bg-card text-text-dim border-border',
            ].join(' ')}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        )
      })}
    </div>
  )
}
