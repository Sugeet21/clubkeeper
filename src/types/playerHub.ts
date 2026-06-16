export interface TopupIntent {
  id: string
  clubId: string
  playerName: string | null
  playerMobile: string        // 10 digits, no +91
  amount: number              // integer rupees
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  rejectReason: string | null
  createdAt: string           // ISO timestamp from Supabase
  confirmedAt: string | null
}

import type { CoinTier, RateTier, GameType } from '.'

// Public-safe slim projection of an owner's active table. Never includes
// internal IDs, session data, or anything beyond what a player needs to see
// pricing. Mirrored to Supabase clubs.tables_json on owner-side table save.
export interface PublicTableInfo {
  name: string
  gameType: GameType
  ratePerHour: number
  ratePerFrame?: number
  rateCard?: RateTier[]
  toleranceMinutes?: number
  rateCardBilling?: 'minimum' | 'prorated'
}

export interface ClubPublicInfo {
  clubName: string
  upiId: string | null
  acceptsTopups: boolean
  coinsEnabled: boolean
  coinTiers: CoinTier[]
  tablesJson: PublicTableInfo[]
  acceptsPricingDisplay: boolean
}
