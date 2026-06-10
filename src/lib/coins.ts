import type { CoinTier } from '../types'

export const DEFAULT_COIN_CONFIG = {
  coinsEnabled: false,
  coinTiers: [
    { minAmount: 100, coins: 5 },
    { minAmount: 500, coins: 50 },
    { minAmount: 1000, coins: 150 },
    { minAmount: 2000, coins: 400 },
  ] as CoinTier[],
  minutesPerCoin: 2,
  rupeesPerCoin: 0.5,
  coinExpiryDays: 60,
  coinMinRedemption: 10,
} as const

export interface CoinConfig {
  coinsEnabled: boolean
  coinTiers: CoinTier[]
  minutesPerCoin: number
  rupeesPerCoin: number
  coinExpiryDays: number
  coinMinRedemption: number
  coinRedemptionModes: 'time' | 'canteen' | 'both'
}

// Returns the resolved config, merging settings with defaults.
export function resolveCoinConfig(settings: {
  coinsEnabled?: boolean
  coinTiers?: CoinTier[]
  minutesPerCoin?: number
  rupeesPerCoin?: number
  coinExpiryDays?: number
  coinMinRedemption?: number
  coinRedemptionModes?: 'time' | 'canteen' | 'both'
}): CoinConfig {
  return {
    coinsEnabled: settings.coinsEnabled ?? DEFAULT_COIN_CONFIG.coinsEnabled,
    coinTiers: settings.coinTiers ?? [...DEFAULT_COIN_CONFIG.coinTiers],
    minutesPerCoin: settings.minutesPerCoin ?? DEFAULT_COIN_CONFIG.minutesPerCoin,
    rupeesPerCoin: settings.rupeesPerCoin ?? DEFAULT_COIN_CONFIG.rupeesPerCoin,
    coinExpiryDays: settings.coinExpiryDays ?? DEFAULT_COIN_CONFIG.coinExpiryDays,
    coinMinRedemption: settings.coinMinRedemption ?? DEFAULT_COIN_CONFIG.coinMinRedemption,
    coinRedemptionModes: settings.coinRedemptionModes ?? 'both',
  }
}

// Returns the coins earned for a given topup amount and tier list.
// Picks the largest tier where tier.minAmount <= amount.
// Returns 0 if no tier qualifies.
export function coinsEarnedForTopup(amount: number, tiers: CoinTier[]): number {
  if (!tiers || tiers.length === 0) return 0
  const sorted = [...tiers].sort((a, b) => b.minAmount - a.minAmount)
  const match = sorted.find((t) => amount >= t.minAmount)
  return match?.coins ?? 0
}

export function coinsToRupees(coins: number, rupeesPerCoin: number): number {
  return Math.floor(coins * rupeesPerCoin)
}

export function coinsToMinutes(coins: number, minutesPerCoin: number): number {
  return coins * minutesPerCoin
}

export function formatCoins(n: number): string {
  return n.toLocaleString('en-IN')
}

// Returns max coins redeemable such that the rupee value does not exceed maxRupees.
export function maxRedeemableCoins(
  availableCoins: number,
  maxRupees: number,
  rupeesPerCoin: number,
): number {
  if (rupeesPerCoin <= 0) return 0
  const coinCap = Math.floor(maxRupees / rupeesPerCoin)
  return Math.min(availableCoins, coinCap)
}
