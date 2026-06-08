import type { RevenueDelta } from '../../lib/summaryMath'

function DeltaChip({
  label,
  delta,
}: {
  label: string
  delta: RevenueDelta | undefined
}) {
  if (!delta) {
    return (
      <div className="flex items-center gap-1.5 bg-bg-card border border-border rounded-full px-3 py-1.5">
        <span className="text-[11px] font-mono text-text-faint">— {label}</span>
      </div>
    )
  }

  const colorClass =
    delta.direction === 'up'
      ? 'text-free'
      : delta.direction === 'down'
      ? 'text-busy'
      : 'text-text-faint'

  const Arrow = () => {
    if (delta.direction === 'flat') return <span className="text-[11px] font-mono">—</span>
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {delta.direction === 'up' ? (
          <polyline points="18 15 12 9 6 15" />
        ) : (
          <polyline points="6 9 12 15 18 9" />
        )}
      </svg>
    )
  }

  return (
    <div
      className={`flex items-center gap-1 bg-bg-card border border-border rounded-full px-3 py-1.5 ${colorClass}`}
    >
      <Arrow />
      <span className="text-[11px] font-mono">
        {delta.direction !== 'flat' ? `${Math.abs(delta.pct)}%` : '0%'} {label}
      </span>
    </div>
  )
}

export default function RevenueDeltas({
  vsYesterday,
  vsLastWeek,
  vs7dAvg,
}: {
  vsYesterday: RevenueDelta | undefined
  vsLastWeek: RevenueDelta | undefined
  vs7dAvg: RevenueDelta | undefined
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <DeltaChip label="vs yesterday" delta={vsYesterday} />
      <DeltaChip label="vs last week" delta={vsLastWeek} />
      <DeltaChip label="vs 7d avg" delta={vs7dAvg} />
    </div>
  )
}
