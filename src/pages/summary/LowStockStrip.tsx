import { useNavigate } from 'react-router-dom'

export default function LowStockStrip({ count }: { count: number }) {
  const navigate = useNavigate()

  if (count === 0) return null

  return (
    <div className="px-5 mt-5">
      <button
        type="button"
        onClick={() => navigate('/canteen')}
        className="w-full bg-paused/12 border border-paused/30 text-paused rounded-2xl px-4 py-3 flex items-center gap-3 min-h-[52px]"
      >
        <span className="text-xl shrink-0">⚠️</span>
        <span className="flex-1 text-left text-[13px] font-semibold">
          {count} item{count !== 1 ? 's' : ''} low on stock
        </span>
        <span className="text-[12px] font-mono shrink-0">Restock →</span>
      </button>
    </div>
  )
}
