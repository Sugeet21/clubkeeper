import type { CanteenItemSummary } from '../../lib/summaryMath'

export default function TopCanteenItems({ items }: { items: CanteenItemSummary[] }) {
  if (items.length === 0) return null

  return (
    <div className="px-5 mt-6">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">
        Top Canteen Items
      </p>
      <div className="bg-bg-card border border-border rounded-2xl px-4 py-3">
        <p className="text-[13px] text-text-dim">
          {items.map((item, idx) => (
            <span key={item.normalizedName}>
              {idx > 0 && (
                <span className="text-text-faint mx-1.5">·</span>
              )}
              <span className="text-text font-medium">{item.displayName}</span>
              <span className="text-text-faint font-mono"> ({item.qty})</span>
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}
