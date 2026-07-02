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
  id?: string
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
  _migrationSeq?: number       // set by v20 .upgrade(), used by §10.4 upload
  updatedAt?: number           // Phase C LWW metadata (#117) — epoch ms; stamped by sync wrappers / read mappers
  deletedAt?: number | null    // Phase C soft-delete marker (#117) — epoch ms
}

export interface TableMove {
  fromTableId: string
  toTableId: string
  movedAt: number  // Unix ms timestamp
}

export interface Session {
  id?: string
  tableId: string
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
  _migrationSeq?: number              // set by v20 .upgrade(), used by §10.4 upload
  updatedAt?: number                  // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null           // Phase C soft-delete marker (#117) — epoch ms
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
    canteenItemId?: string                                    // matched CanteenItem.id; absent for unmatched
  }>
  subtotal: number                                            // sum of price * quantity (integer rupees)
  paymentBreakdown: PaymentBreakdown                          // cash + upi + wallet === total
  total: number                                               // === subtotal in v1 (no discount); kept for future-proofing
  customerId?: string                                         // present only when wallet portion > 0
  notes?: string                                              // max 200 chars
  updatedAt?: number                                          // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null                                   // Phase C soft-delete marker (#117) — epoch ms
}

/**
 * Canteen restock log entry. Source 'piggy' deducts from piggy balance;
 * 'other' does not. Inserted atomically with CanteenItem.currentStock
 * increment when stockEnabled=true.
 */
export interface StockPurchase {
  id: string                  // UUID v4
  canteenItemId: string       // FK → CanteenItem.id (UUID)
  quantityAdded: number       // integer ≥ 1
  cost: number                // total cost paid for this restock (integer rupees, ≥ 0)
  source: 'piggy' | 'other'
  createdAt: number           // Unix ms
  notes?: string              // max 200 chars
  updatedAt?: number          // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null   // Phase C soft-delete marker (#117) — epoch ms
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
  /** @deprecated 22 Jun 2026 — replaced by bookingAdvancePerSlot. Retained for
   *  Dexie/Supabase column compatibility. Do not read for new computation. */
  bookingAdvanceAmount?: number   // ₹; default 100; range 0–10000
  // v19: per-club operating hours + per-30-min-slot advance (#106)
  bookingOpenMinutes?: number     // 0–1439; minutes since local midnight. undefined until owner sets.
  bookingCloseMinutes?: number    // 1–2880; > bookingOpenMinutes. Value > 1440 = next-day close.
  bookingAdvancePerSlot?: number  // 0–2000; default 50. Final advance = ceil(durationMin/30) * this.
  // v18: Peak Hour Pricing (#68). All optional, undefined = feature off.
  peakPricingEnabled?: boolean    // master toggle; default false
  peakStartHour?: number          // 0-23, default 22 (10 PM)
  peakStartMinute?: number        // 0-59, default 0
  peakEndHour?: number            // 0-23, default 6 (6 AM)
  peakEndMinute?: number          // 0-59, default 0
  // v21: Phase C Chunk 5 — per-table initial-pull cursor map. Each entry is
  // a COMPOUND cursor: the last (updated_at, id) tuple applied for that table.
  // Compound is required because .gt('updated_at', cursor) skips rows sharing
  // the exact cursor timestamp at a page boundary (silent data loss). The
  // pull query is `(updated_at > ts) OR (updated_at = ts AND id > cursor.id)`
  // ordered by (updated_at, id) — see syncReader.ts initialPull.
  //
  // Realtime events (Chunk 5.3) also advance the cursor so a polling-fallback
  // reconnect (Chunk 5.4) never re-pulls events realtime already delivered.
  //
  // WRITE PATH: must go through src/db/syncPullCursors.ts (raw db.settings.update)
  // — never via a sync wrapper, or the cursor write itself would queue an
  // outbox row. Read path is via getPullCursor / getAllPullCursors.
  pullCursors?: Partial<Record<SyncTableName, { ts: string; id: string } | null>>
}

export interface CanteenItem {
  id?: string
  name: string           // 1-50 chars
  defaultPrice: number   // integer rupees, 1-9999
  stockEnabled: boolean  // default false
  currentStock: number | null // null when stockEnabled=false, integer >=0 otherwise
  isActive: boolean      // soft-delete pattern
  createdAt: number
  sortOrder: number
  peakPrice?: number     // v18: optional peak-hour price, integer rupees, 1-9999. Undefined = item never uses peak pricing.
  _migrationSeq?: number // set by v20 .upgrade(), used by §10.4 upload
  updatedAt?: number     // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null // Phase C soft-delete marker (#117) — epoch ms
}

export interface SessionItem {
  id?: string
  sessionId: string     // FK to sessions table
  name: string          // 1-50 chars after trim
  price: number         // integer rupees, 0-99999
  quantity: number      // integer, 1-99
  addedAt: number       // Date.now() at creation
  _migrationSeq?: number // set by v20 .upgrade(), used by §10.4 upload
  updatedAt?: number    // Phase C LWW metadata (#117) — epoch ms
  deletedAt?: number | null // Phase C soft-delete marker (#117) — epoch ms
}

// ─── Outbox (Phase C sync queue — local-only, never exported) ────────────────
// _outbox rows represent pending Supabase writes. Phase B declares the table;
// Phase C adds the worker that drains it. No code writes to _outbox yet.

/**
 * The 9 synced tables in their Supabase (snake_case) names. The outbox stores
 * the wire-format name so the Phase C SyncRunner.pushOne can pass it directly
 * to `supabase.from(table)` without a per-row conversion. A Dexie-side mapper
 * lives next to syncRunner.ts when Phase C ships.
 */
export type SyncTableName =
  | 'game_tables'
  | 'sessions'
  | 'session_items'
  | 'canteen_items'
  | 'customers'
  | 'wallet_transactions'
  | 'canteen_sales'
  | 'stock_purchases'
  | 'bookings'

export interface OutboxRow {
  seq?: number              // auto-inc, ensures FIFO ordering
  idempotencyKey: string    // UUID, used as Supabase upsert conflict key (Phase C)
  table: SyncTableName      // Supabase snake_case name; pushOne passes directly to .from()
  op: 'insert' | 'update' | 'soft_delete'
  rowId: string             // the data row's UUID
  payload: unknown          // for insert/update: full row body; for soft_delete: { deleted_at }
  attempts: number
  lastError: string | null
  lastAttemptAt: number | null
  createdAt: number
  // Phase C Chunk 4 — set to true once attempts hits the dead-letter threshold
  // (>=10). Stuck rows stay in the outbox but are SKIPPED by SyncRunner.drainOnce
  // so a single bad row can't block the rest of the queue. Surfaced to the
  // sync-indicator UI in a later chunk; manual unstick via DEV TestOutbox page.
  stuck?: boolean
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
