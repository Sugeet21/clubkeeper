export type GameType = 'pool' | 'snooker' | 'carrom' | 'playstation' | 'other'
export type BillingMode = 'per_hour' | 'per_frame'
export type TableStatus = 'free' | 'busy' | 'paused' | 'out_of_service'

export interface GameTable {
  id?: number
  name: string
  gameType: GameType
  ratePerHour: number
  ratePerFrame?: number
  outOfService: boolean
  createdAt: number
  sortOrder: number
}

export interface Session {
  id?: number
  tableId: number
  startedAt: number
  endedAt: number | null
  pausedTotalMs: number
  pausedAt: number | null
  billingMode: BillingMode
  rateSnapshot: number
  playerName: string | null
  playerCount: number
  note: string | null
  framesPlayed: number | null
  status: 'running' | 'paused' | 'completed'
  amount: number
  roundedDurationMs?: number  // set when rounding applied; undefined = raw elapsed used
}

export interface ClubSettings {
  id: number
  clubName: string
  currency: string
  rounding: 'none' | '15min' | '30min'
}
