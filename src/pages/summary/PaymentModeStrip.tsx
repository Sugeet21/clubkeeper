function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

interface PaymentModeStripProps {
  cash: number
  upi: number
  wallet: number
  runningSessionsExcluded: number
}

/**
 * Three-tile breakdown of cash / UPI / wallet collected on the selected date.
 * Aggregates across both stopped sessions (with paymentBreakdown) and
 * walk-in canteen sales. Running sessions are EXCLUDED — their breakdown
 * is unknown until stop.
 *
 * Hidden entirely when cash+upi+wallet === 0 (caller decides).
 *
 * Percent rounding uses largest-remainder: each value rounds to nearest int,
 * then any difference from 100 is added to / removed from the largest tile.
 */
export default function PaymentModeStrip({
  cash,
  upi,
  wallet,
  runningSessionsExcluded,
}: PaymentModeStripProps) {
  const total = cash + upi + wallet
  const { cashPct, upiPct, walletPct } = computePercents(cash, upi, wallet, total)

  return (
    <div className="px-5 mt-5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
        Payment Mode
      </p>

      {/* Three tiles */}
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Cash" amount={cash} pct={cashPct} hasTotal={total > 0} />
        <Tile label="UPI" amount={upi} pct={upiPct} hasTotal={total > 0} />
        <Tile label="Wallet" amount={wallet} pct={walletPct} hasTotal={total > 0} />
      </div>

      {/* Split bar */}
      <div className="mt-3 h-[6px] rounded-full overflow-hidden flex">
        {total === 0 ? (
          <div className="flex-1 bg-border" />
        ) : (
          <>
            {cash > 0 && (
              <div className="h-full bg-accent" style={{ width: `${cashPct}%` }} />
            )}
            {upi > 0 && (
              <div className="h-full bg-text-dim" style={{ width: `${upiPct}%` }} />
            )}
            {wallet > 0 && (
              <div className="h-full bg-paused" style={{ width: `${walletPct}%` }} />
            )}
          </>
        )}
      </div>

      {runningSessionsExcluded > 0 && (
        <p className="text-[11px] font-mono text-text-faint mt-2">
          Excludes {runningSessionsExcluded} running session
          {runningSessionsExcluded === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

function Tile({
  label,
  amount,
  pct,
  hasTotal,
}: {
  label: string
  amount: number
  pct: number
  hasTotal: boolean
}) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl p-3 flex flex-col gap-0.5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
        {label}
      </p>
      <p className="text-[16px] font-bold font-mono text-text tabular-nums truncate">
        {formatINR(amount)}
      </p>
      <p className="text-[10px] font-mono text-text-faint">
        {hasTotal ? `${pct}%` : '—'}
      </p>
    </div>
  )
}

function computePercents(
  cash: number,
  upi: number,
  wallet: number,
  total: number,
): { cashPct: number; upiPct: number; walletPct: number } {
  if (total === 0) return { cashPct: 0, upiPct: 0, walletPct: 0 }
  const raw = [
    { key: 'cash', value: cash },
    { key: 'upi', value: upi },
    { key: 'wallet', value: wallet },
  ]
  // Round each to nearest integer
  const rounded = raw.map((r) => ({
    key: r.key,
    pct: Math.round((r.value / total) * 100),
    value: r.value,
  }))
  const sum = rounded.reduce((s, r) => s + r.pct, 0)
  let diff = 100 - sum
  // Largest-remainder: push the diff onto the largest tile by absolute value
  if (diff !== 0) {
    // Sort by absolute amount desc; adjust the largest first
    const order = [...rounded].sort((a, b) => b.value - a.value)
    for (const r of order) {
      if (diff === 0) break
      const adj = diff > 0 ? 1 : -1
      r.pct += adj
      diff -= adj
    }
  }
  const find = (k: string) => rounded.find((r) => r.key === k)?.pct ?? 0
  return {
    cashPct: find('cash'),
    upiPct: find('upi'),
    walletPct: find('wallet'),
  }
}
