import { useNavigate } from 'react-router-dom'

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

interface CashFlowStripProps {
  piggyCurrent: number               // clamp at caller; we render as-is
  piggyOpening: number
  cashInToday: number                // cash added to piggy on the viewed date
  spentOnStockToday: number          // sum of cost where source='piggy' on viewed date
  spentOnStockTodayCount: number     // restock row count (any source) on viewed date
  spentOnStockTodayTotal: number     // sum of ALL restock cost on viewed date (any source)
  warnNegative: boolean
}

/**
 * Two tiles: PIGGY (cash float) + STOCK BOUGHT TODAY.
 * Both are tappable and navigate to /piggy.
 */
export default function CashFlowStrip({
  piggyCurrent,
  piggyOpening,
  cashInToday,
  spentOnStockToday,
  spentOnStockTodayCount,
  spentOnStockTodayTotal,
  warnNegative,
}: CashFlowStripProps) {
  const navigate = useNavigate()
  const displayPiggy = Math.max(0, piggyCurrent)

  return (
    <div className="px-5 mt-5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
        Cash Flow
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* PIGGY tile */}
        <button
          onClick={() => navigate('/piggy')}
          className="bg-bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Piggy (cash float)
          </p>
          <p className="text-[22px] font-bold font-mono text-text tabular-nums mt-1 truncate">
            {formatINR(displayPiggy)}
          </p>
          <p className="text-[10px] font-mono text-text-faint mt-1 truncate">
            Opening {formatINR(piggyOpening)} · +{formatINR(cashInToday)} today · −
            {formatINR(spentOnStockToday)} spent today
          </p>
          {warnNegative && (
            <p className="text-[10px] text-paused mt-1">
              Piggy negative — check restock log
            </p>
          )}
        </button>

        {/* STOCK BOUGHT TODAY tile */}
        <button
          onClick={() => navigate('/piggy')}
          className="bg-bg-card border border-border rounded-2xl p-4 text-left active:scale-[0.99] transition-transform"
        >
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Stock bought today
          </p>
          <p className="text-[22px] font-bold font-mono text-text tabular-nums mt-1 truncate">
            {formatINR(spentOnStockTodayTotal)}
          </p>
          <p className="text-[10px] font-mono text-text-faint mt-1">
            {spentOnStockTodayCount} restock{spentOnStockTodayCount === 1 ? '' : 's'}
          </p>
        </button>
      </div>
    </div>
  )
}
