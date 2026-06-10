import { useState } from 'react'
import type { Customer } from '../types/customer'
import type { CoinConfig } from '../lib/coins'
import { coinsToRupees, maxRedeemableCoins, formatCoins } from '../lib/coins'

interface Props {
  customer: Customer
  config: CoinConfig
  maxApplicable: number       // upper bound in ₹ the discount can reach (e.g. bill amount)
  onChange: (coinsToRedeem: number, rupeeDiscount: number) => void
  applied: number             // coins already applied (controlled by parent)
}

// CoinRedemptionPill — shows a compact amber pill. Tap → slider to choose coins.
// Returns null when balance < coinMinRedemption (nothing to show).
export function CoinRedemptionPill({ customer, config, maxApplicable, onChange, applied }: Props) {
  const balance = customer.coinBalance ?? 0
  const [expanded, setExpanded] = useState(false)
  const [sliderValue, setSliderValue] = useState(0)

  if (balance < config.coinMinRedemption) return null

  const maxCoins = maxRedeemableCoins(balance, maxApplicable, config.rupeesPerCoin)
  // Slider step: 5 for ranges > 50, 1 for small ranges
  const step = maxCoins > 50 ? 5 : 1
  // Snap slider max to a multiple of step
  const sliderMax = Math.floor(maxCoins / step) * step

  const rupeesOff = coinsToRupees(sliderValue, config.rupeesPerCoin)

  function handleApply() {
    onChange(sliderValue, rupeesOff)
    setExpanded(false)
  }

  function handleRemove() {
    onChange(0, 0)
    setSliderValue(0)
  }

  if (applied > 0 && !expanded) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
        <span className="text-[13px] text-amber-400 flex-1 font-semibold">
          {formatCoins(applied)} coins applied · ₹{coinsToRupees(applied, config.rupeesPerCoin).toLocaleString('en-IN')} off
        </span>
        <button
          onClick={handleRemove}
          className="min-h-[32px] px-2.5 text-[12px] text-text-dim border border-border rounded-lg"
        >
          Remove
        </button>
      </div>
    )
  }

  if (!expanded) {
    return (
      <button
        onClick={() => { setSliderValue(Math.min(sliderMax, balance)); setExpanded(true) }}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-amber-500/8 border border-amber-500/25 rounded-xl"
      >
        <span className="text-[13px] text-amber-400 font-semibold flex-1 text-left">
          🪙 {formatCoins(balance)} ClubCoins available
        </span>
        <span className="text-[12px] text-amber-400/70 shrink-0">Use →</span>
      </button>
    )
  }

  return (
    <div className="bg-amber-500/8 border border-amber-500/25 rounded-xl px-3 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-amber-400">Use ClubCoins</p>
        <button
          onClick={() => setExpanded(false)}
          className="min-w-[28px] min-h-[28px] flex items-center justify-center text-text-faint"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-1.5">
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={step}
          value={sliderValue}
          onChange={(e) => setSliderValue(Number(e.target.value))}
          className="w-full accent-amber-400"
          style={{ minHeight: '44px' }}
        />
        <div className="flex justify-between text-[11px] text-text-faint">
          <span>0</span>
          <span>{formatCoins(sliderMax)} coins</span>
        </div>
      </div>

      {sliderValue > 0 ? (
        <p className="text-[14px] text-amber-400 font-semibold text-center">
          Redeeming {formatCoins(sliderValue)} coins = <span className="text-text">₹{rupeesOff.toLocaleString('en-IN')} off</span>
        </p>
      ) : (
        <p className="text-[13px] text-text-faint text-center">Move slider to choose coins</p>
      )}

      <button
        onClick={handleApply}
        disabled={sliderValue === 0}
        className={`w-full min-h-[44px] rounded-xl font-bold text-[14px] transition-opacity ${
          sliderValue > 0 ? 'bg-amber-500 text-bg' : 'bg-amber-500/30 text-bg/50 cursor-not-allowed'
        }`}
      >
        Apply
      </button>
    </div>
  )
}
