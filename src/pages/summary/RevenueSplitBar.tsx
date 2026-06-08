function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

export default function RevenueSplitBar({
  tablesRevenue,
  canteenRevenue,
}: {
  tablesRevenue: number
  canteenRevenue: number
}) {
  const total = tablesRevenue + canteenRevenue
  const tablesPct = total === 0 ? 0 : Math.round((tablesRevenue / total) * 100)
  const canteenPct = total === 0 ? 0 : 100 - tablesPct

  // When only one source, make full bar for that source
  const tablesBarPct = total === 0 ? 50 : tablesPct
  const canteenBarPct = total === 0 ? 50 : canteenPct

  return (
    <div className="px-5 mt-5">
      {/* Two tiles */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
            Tables
          </p>
          <p className="text-[18px] font-bold font-mono text-text">
            {formatINR(tablesRevenue)}
          </p>
          <p className="text-[11px] font-mono text-text-faint mt-0.5">
            {total === 0 ? '—' : `${tablesPct}%`}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
            Canteen
          </p>
          <p className="text-[18px] font-bold font-mono text-text">
            {formatINR(canteenRevenue)}
          </p>
          <p className="text-[11px] font-mono text-text-faint mt-0.5">
            {total === 0 ? '—' : `${canteenPct}%`}
          </p>
        </div>
      </div>

      {/* Split bar */}
      <div className="mt-3 h-[6px] rounded-full overflow-hidden flex">
        {total === 0 ? (
          <div className="flex-1 bg-border" />
        ) : (
          <>
            <div
              className="h-full bg-accent rounded-l-full"
              style={{ width: `${tablesBarPct}%` }}
            />
            <div
              className="h-full bg-paused rounded-r-full"
              style={{ width: `${canteenBarPct}%` }}
            />
          </>
        )}
      </div>
    </div>
  )
}
