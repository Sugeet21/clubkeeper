import type { TableSummary } from '../../lib/summaryMath'
import { formatDuration } from '../../lib/time'

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

const MEDALS = ['🥇', '🥈', '🥉']

export default function TopTablesList({ tables }: { tables: TableSummary[] }) {
  if (tables.length === 0) return null

  const top = tables.slice(0, 3)

  return (
    <div className="px-5 mt-6">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">
        Top Tables
      </p>
      <div className="space-y-2">
        {top.map((t, idx) => {
          const avgMs =
            t.sessionCount > 0 ? Math.round(t.totalDurationMs / t.sessionCount) : 0
          return (
            <div
              key={t.tableId}
              className="flex items-center gap-3 bg-bg-card border border-border rounded-2xl px-4 py-3 min-h-[56px]"
            >
              <span className="text-xl shrink-0">{MEDALS[idx]}</span>
              <span className="flex-1 text-[14px] font-semibold text-text truncate min-w-0">
                {t.tableName}
              </span>
              <div className="text-right shrink-0">
                <p className="text-[12px] font-mono font-bold text-text">
                  {formatINR(t.revenue)}
                </p>
                <p className="text-[11px] font-mono text-text-dim">
                  {t.sessionCount} sess · {formatDuration(avgMs)} avg
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
