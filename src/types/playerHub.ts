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

import type { CoinTier } from '.'

export interface ClubPublicInfo {
  clubName: string
  upiId: string | null
  acceptsTopups: boolean
  coinsEnabled: boolean
  coinTiers: CoinTier[]
}
