import { useState } from 'react'
import type { HourlyBucket } from '../../lib/summaryMath'

function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

export default function HourlyHeatmap({
  buckets,
  peakHour,
}: {
  buckets: HourlyBucket[]
  peakHour: number
}) {
  const [selectedHour, setSelectedHour] = useState<number | null>(null)

  // Find first/last hours with revenue
  let firstHour = -1
  let lastHour = -1
  for (let i = 0; i < 24; i++) {
    if (buckets[i].revenue > 0) {
      if (firstHour === -1) firstHour = i
      lastHour = i
    }
  }

  // No data — hide entire section
  if (firstHour === -1) return null

  const peakRevenue = peakHour >= 0 ? buckets[peakHour].revenue : 0
  const visibleBuckets = buckets.slice(firstHour, lastHour + 1)

  const selectedBucket = selectedHour !== null ? buckets[selectedHour] : null

  return (
    <div className="px-4 pt-3">
      <div className="space-y-0.5">
        {visibleBuckets.map((bucket) => {
          const widthPct =
            peakRevenue > 0 ? (bucket.revenue / peakRevenue) * 100 : 0
          const isPeak = bucket.hour === peakHour && peakRevenue > 0
          const isSelected = selectedHour === bucket.hour
          const barTooShort = widthPct < 35

          return (
            <button
              key={bucket.hour}
              type="button"
              onClick={() =>
                setSelectedHour(isSelected ? null : bucket.hour)
              }
              className={`w-full flex items-center gap-3 min-h-[44px] py-1.5 rounded-md transition-colors ${
                isSelected ? 'bg-accent/8' : 'hover:bg-bg-card/50'
              }`}
            >
              {/* Hour label */}
              <span className="text-[11px] font-mono font-medium text-text-faint w-12 shrink-0 text-right">
                {formatHour(bucket.hour)}
              </span>

              {/* Bar track */}
              <div className="flex-1 h-7 bg-bg-card rounded-md overflow-hidden relative">
                {bucket.revenue > 0 && (
                  <div
                    className="h-full bg-accent rounded-md relative flex items-center justify-end pr-2"
                    style={{ width: `${widthPct}%` }}
                  >
                    {/* Peak label inside bar if wide enough */}
                    {isPeak && !barTooShort && (
                      <span className="text-[10px] font-mono font-bold text-bg whitespace-nowrap">
                        {formatINR(bucket.revenue)}
                      </span>
                    )}
                  </div>
                )}
                {/* Peak label outside bar if bar is short */}
                {isPeak && barTooShort && bucket.revenue > 0 && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-text-faint whitespace-nowrap"
                    style={{ left: `calc(${widthPct}% + 6px)` }}
                  >
                    {formatINR(bucket.revenue)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Tooltip strip */}
      {selectedBucket && (
        <div className="mt-2 bg-bg-card border border-accent/30 rounded-xl px-3 py-2 text-[13px] text-text">
          <span className="font-semibold">{formatHour(selectedBucket.hour)}</span>
          <span className="text-text-dim mx-1.5">·</span>
          <span className="font-mono">{formatINR(selectedBucket.revenue)}</span>
          <span className="text-text-dim mx-1.5">·</span>
          <span className="text-text-dim">
            {selectedBucket.sessionCount} session{selectedBucket.sessionCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
