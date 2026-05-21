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

// ─── Auth & Subscription ──────────────────────────────────────────────────────

export interface UserProfile {
  id: string              // matches Supabase auth.users.id (uuid)
  email: string
  displayName: string | null
  avatarUrl: string | null
  clubName: string | null // set during onboarding
  createdAt: number
}

export type SubscriptionStatus =
  | 'none'        // never subscribed
  | 'trialing'    // 7-day free trial active
  | 'active'      // paid and active
  | 'past_due'    // payment failed, grace period
  | 'cancelled'   // user cancelled
  | 'expired'     // ended without renewal

export type PlanTier = 'starter' | 'standard' | 'pro'

export interface Subscription {
  id: string
  userId: string
  status: SubscriptionStatus
  plan: PlanTier
  trialEndsAt: number | null        // Unix ms
  currentPeriodStart: number | null
  currentPeriodEnd: number | null
  razorpayCustomerId: string | null
  razorpaySubscriptionId: string | null
  cancelAtPeriodEnd: boolean
  createdAt: number
  updatedAt: number
}
