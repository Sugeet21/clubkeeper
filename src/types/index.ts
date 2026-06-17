export type GameType = 'pool' | 'snooker' | 'carrom' | 'playstation' | 'other'

export interface RateTier {
  minutes: number   // 1-720; must be unique and sorted ascending within a card
  price: number     // integer rupees, 1-99999
}

// ─── Razorpay ────────────────────────────────────────────────────────────────

export interface RazorpayCheckoutOptions {
  key: string
  subscription_id: string
  name: string
  description: string
  prefill?: { name?: string; email?: string }
  theme?: { color?: string }
  handler: (response: RazorpayResponse) => void
  modal?: { ondismiss?: () => void }
}

export interface RazorpayResponse {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

export interface RazorpayInstance {
  open: () => void
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayCheckoutOptions) => RazorpayInstance
  }
}
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
  rateCard?: RateTier[]        // if present + non-empty → tier-based billing
  toleranceMinutes?: number    // default 10 when rateCard exists; ignored when absent
  rateCardBilling?: 'minimum' | 'prorated'  // v11: default 'prorated' if omitted
}

export interface TableMove {
  fromTableId: number
  toTableId: number
  movedAt: number  // Unix ms timestamp
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
  notifyAtMs?: number | null          // absolute Unix ms when alarm should fire; undefined/null = no alarm
  notifyAcknowledgedAt?: number | null // Unix ms when owner tapped Stop or Snooze; null = alarm pending
  tableMoves?: TableMove[]            // v9: journey of table hops; undefined = no moves (legacy rows)
  rateCardSnapshot?: RateTier[]       // v10: captured at startSession; presence → tier billing
  toleranceMinutesSnapshot?: number   // v10: captured at startSession; default 10
  rateCardBillingSnapshot?: 'minimum' | 'prorated'  // v11: captured at startSession; default 'prorated'
  isBackEntry?: boolean               // v12: true if logged via Back Entry flow, not live timer
  paymentBreakdown?: PaymentBreakdown // v13: cash/UPI/wallet split captured at stopSession; sum === amount
  paymentInProgress?: boolean         // true while session is paused waiting for staff to confirm payment
}

/**
 * How a bill was paid. All three values are integer rupees ≥ 0.
 * Invariant (enforced at write time in Phase 2+):
 *   paymentBreakdown.cash + paymentBreakdown.upi + paymentBreakdown.wallet === total
 * Backfill rule: existing completed sessions get { cash: amount, upi: 0, wallet: 0 }.
 */
export interface PaymentBreakdown {
  cash: number
  upi: number
  wallet: number
}

/**
 * Walk-in canteen sale (no table session). Atomic — no start/end, just one
 * row written at confirm time. Stock decrements happen in the same Dexie tx.
 */
export interface CanteenSale {
  id: string                                                  // UUID v4
  createdAt: number                                           // Unix ms
  items: Array<{
    name: string
    price: number                                             // integer rupees
    quantity: number                                          // integer ≥ 1
    canteenItemId?: number                                    // matched CanteenItem.id; absent for unmatched (v1: always matched)
  }>
  subtotal: number                                            // sum of price * quantity (integer rupees)
  paymentBreakdown: PaymentBreakdown                          // cash + upi + wallet === total
  total: number                                               // === subtotal in v1 (no discount); kept for future-proofing
  customerId?: string                                         // present only when wallet portion > 0
  notes?: string                                              // max 200 chars
}

/**
 * Canteen restock log entry. Source 'piggy' deducts from piggy balance;
 * 'other' does not. Inserted atomically with CanteenItem.currentStock
 * increment when stockEnabled=true.
 */
export interface StockPurchase {
  id: string                  // UUID v4
  canteenItemId: number       // FK → CanteenItem.id
  quantityAdded: number       // integer ≥ 1
  cost: number                // total cost paid for this restock (integer rupees, ≥ 0)
  source: 'piggy' | 'other'
  createdAt: number           // Unix ms
  notes?: string              // max 200 chars
}

export interface CoinTier {
  minAmount: number  // ₹ — topup must be ≥ this to earn this tier's coins
  coins: number      // ClubCoins credited when this tier is the highest qualifying tier
}

export interface ClubSettings {
  id: number
  clubName: string
  currency: string
  rounding: 'none' | '15min' | '30min'
  upiId?: string        // optional — if set, show payment QR after session stop
  walkInCounter?: number // incremented when a walk-in customer is created; treat missing as 0
  legacyAdjustmentsBackfilled?: boolean // set true by v6 migration; never write false
  alarmSoundEnabled?: boolean    // default true; stored in Dexie, NOT localStorage
  alarmVibrationEnabled?: boolean // default true; stored in Dexie, NOT localStorage
  lowStockThreshold?: number     // default 5; treat missing as 5
  piggyOpeningBalance?: number   // v13: owner-settable opening cash float; treat missing as 0
  piggyStartedAt?: number        // v13: Unix ms; piggy aggregation window start. Set at v13 upgrade if absent.
  slug?: string                  // v14: Player Hub slug; mirrors Supabase clubs.slug
  slugLocked?: boolean           // v14: true after first successful slug save; UI blocks further edits
  acceptsTopups?: boolean        // v15+: mirrors Supabase clubs.accepts_topups; default true
  coinRedemptionModes?: 'time' | 'canteen' | 'both'  // where coins can be redeemed; default 'time' for new clubs
  // v15: ClubCoins config — all optional; undefined = use DEFAULT_COIN_CONFIG values
  coinsEnabled?: boolean         // master switch; undefined/false = off. Owner must explicitly enable.
  coinTiers?: CoinTier[]         // ordered ascending by minAmount
  minutesPerCoin?: number        // for time-based redemption; default 2
  rupeesPerCoin?: number         // for ₹-discount redemption; default 0.5
  coinExpiryDays?: number        // referenced by Phase 3 expiry job; defined now, not enforced
  coinMinRedemption?: number     // floor below which redemption pill is hidden; default 10
  // v16: engagement features — all optional, undefined = feature off
  welcomeBonusEnabled?: boolean
  welcomeBonusCoins?: number     // default 50
  streakEnabled?: boolean
  streakRequiredDays?: number    // default 3
  streakWindowDays?: number      // default 7
  streakBonusCoins?: number      // default 50
  dormancyEnabled?: boolean
  dormantThresholdDays?: number  // default 14
  nudgeTemplate?: string
  // v17: advance booking (Phase 1 of #84)
  acceptsBookings?: boolean       // mirrors Supabase clubs.accepts_bookings; treat missing as false
  bookingAdvanceAmount?: number   // ₹; default 100; range 0–10000
}

export interface CanteenItem {
  id?: number
  name: string           // 1-50 chars
  defaultPrice: number   // integer rupees, 1-9999
  stockEnabled: boolean  // default false
  currentStock: number | null // null when stockEnabled=false, integer >=0 otherwise
  isActive: boolean      // soft-delete pattern
  createdAt: number
  sortOrder: number
}

export interface SessionItem {
  id?: number
  sessionId: number     // FK to sessions table
  name: string          // 1-50 chars after trim
  price: number         // integer rupees, 0-99999
  quantity: number      // integer, 1-99
  addedAt: number       // Date.now() at creation
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
