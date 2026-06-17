# Data Model

## Database: ClubKeeperDB (Dexie / IndexedDB)

Database name is `ClubKeeperDB_<userId>` (Supabase UUID) for per-user isolation. The `db` export is a Proxy over a re-openable instance — see `database.ts`.

### Schema Version History

| Version | When | What changed |
|---|---|---|
| v1 | Prompts 0–6 | `gameTables`, `sessions`, `settings` |
| v2 | Prompt 7 | Same stores; adds optional `roundedDurationMs` field on sessions (no index change) |
| v3 | 26 May 2026 | Adds `sessionItems: '++id, sessionId, addedAt'` |
| v4 | 27 May 2026 | Documents `upiId` field on settings (no index needed) |
| v5 | 30 May 2026 | Adds `customers` + `walletTransactions` tables |
| v6 | 30 May 2026 | `.upgrade()` backfill of legacy `type:'adjustment'` wallet tx rows |
| v7 | 31 May 2026 | Adds optional alarm fields on sessions: `notifyAtMs`, `notifyAcknowledgedAt`; adds `alarmSoundEnabled`/`alarmVibrationEnabled` to ClubSettings |
| v8 | 7 Jun 2026 | Adds `canteenItems: '++id, name, isActive, sortOrder'`; adds `lowStockThreshold` to ClubSettings |
| v9 | 8 Jun 2026 | Adds optional `tableMoves?: TableMove[]` field to sessions (no index) |
| v10 | 9 Jun 2026 | Adds optional `rateCard`/`toleranceMinutes` to `GameTable`; `rateCardSnapshot`/`toleranceMinutesSnapshot` to `Session` |
| v11 | 9 Jun 2026 | Adds optional `rateCardBilling` to `GameTable`; `rateCardBillingSnapshot` to `Session` |
| v12 | 9 Jun 2026 | Additive: adds optional `isBackEntry?: boolean` on sessions. No new index. No `.upgrade()`. |
| v13 | 10 Jun 2026 | Split payments + walk-in canteen sale + piggy. New tables `canteenSales` and `stockPurchases`. Adds optional `Session.paymentBreakdown`, `ClubSettings.piggyOpeningBalance` + `piggyStartedAt`. `.upgrade()` backfills completed sessions with `{cash: amount, upi: 0, wallet: 0}` and initialises piggy settings. ⚠ Items-revenue gap in backfill. |
| v14 | 10–11 Jun 2026 | `ClubSettings.slug?` + `slugLocked?` for Player Hub. Additive, no `.upgrade()`. |
| v15 | 10–11 Jun 2026 | `Customer.coinBalance?`. `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`. `ClubSettings` coin config fields + `acceptsTopups?` + `coinRedemptionModes?`. Same store strings as v14. No `.upgrade()`. |
| v16 | 10–11 Jun 2026 | `Customer.firstTopupAt?/lastStreakBonusAt?/expiryAppliedAt?`. `ClubSettings` engagement fields. `WalletReferenceType` extended. Same store strings. No `.upgrade()`. |
| **v17** | **17 Jun 2026** | **Adds `bookings: 'id, tableId, slotStart, status, [tableId+slotStart]'` store (Phase 1 advance booking, #84). Adds optional `ClubSettings.acceptsBookings?/bookingAdvanceAmount?`. Additive, no `.upgrade()`. Current version.** |

### Schema Version 16 (current)

```ts
// v13 through v16 all share the same store strings
this.version(16).stores({
  gameTables: '++id, name, gameType, sortOrder, outOfService',
  sessions: '++id, tableId, status, startedAt, endedAt',
  settings: 'id',
  sessionItems: '++id, sessionId, addedAt',
  customers: 'id, phone, walkInCode, lastVisitAt',
  walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
  canteenItems: '++id, name, isActive, sortOrder',
  canteenSales: 'id, createdAt, customerId',
  stockPurchases: 'id, createdAt, canteenItemId, source',
}).upgrade(async (tx) => {
  // Backfill paymentBreakdown for completed sessions as { cash: amount, upi: 0, wallet: 0 }.
  // ⚠ This uses session.amount only — time-portion. Items revenue from pre-v13 stopped
  // sessions is missing from paymentBreakdown.cash. Documented gap; fix deferred.
  // Initialise piggyOpeningBalance=0 and piggyStartedAt=Date.now() on the settings row
  // only if absent — does not overwrite owner-set values.
})
```

### Tables Store

```ts
interface RateTier {
  minutes: number;   // session duration threshold (integer minutes, ascending)
  price: number;     // charge in ₹ (integer) at or up to this duration
}

interface GameTable {
  id?: number;              // auto-incremented
  name: string;             // "Pool 1" — max 30 chars, alphanumeric+spaces+.-_
  gameType: 'pool' | 'snooker' | 'carrom' | 'playstation' | 'other';
  ratePerHour: number;      // rupees, integer, 1-99999
  ratePerFrame?: number;    // optional, used only for snooker per-frame
  outOfService: boolean;    // true = soft-deleted (hidden from Home)
  createdAt: number;        // Date.now() at creation
  sortOrder: number;        // for ordering in UI, increment by 1
  // Rate card fields (v10/v11 — all optional, undefined = use ratePerHour)
  rateCard?: RateTier[];              // tier-based pricing; if set, overrides ratePerHour for per_hour billing
  toleranceMinutes?: number;          // grace window at each tier boundary (default 10 if rateCard present)
  rateCardBilling?: 'minimum' | 'prorated'; // billing algorithm (default 'prorated')
}
```

### Sessions Store

```ts
interface Session {
  id?: number;
  tableId: number;          // ALWAYS current table (updated by moveSessionToTable)
  startedAt: number;        // Unix ms — NEVER mutated except via editStartTime
  endedAt: number | null;   // null while running/paused
  pausedTotalMs: number;    // accumulated paused time
  pausedAt: number | null;  // Date.now() of current pause, null if not paused
  billingMode: 'per_hour' | 'per_frame';
  rateSnapshot: number;     // rate captured at session start — doesn't change if table rate edited
  playerName: string | null;// max 50 chars
  playerCount: number;      // 1-20
  note: string | null;      // max 200 chars
  framesPlayed: number | null;  // only for per_frame
  status: 'running' | 'paused' | 'completed';
  amount: number;           // calculated when stopped (integer rupees)
  roundedDurationMs?: number;           // v2: stores rounded duration if rounding applied
  notifyAtMs?: number | null;           // v7: absolute Unix ms when alarm should fire; undefined/null = no alarm
  notifyAcknowledgedAt?: number | null; // v7: Unix ms when owner tapped Stop or Snooze; null = pending
  tableMoves?: TableMove[];             // v9: journey log; undefined = no moves (legacy safe)
  // Rate card snapshot triple (v10/v11) — Pattern T7: must always be set together
  rateCardSnapshot?: RateTier[];                        // captured from table.rateCard at session start
  toleranceMinutesSnapshot?: number;                    // captured from table.toleranceMinutes at session start
  rateCardBillingSnapshot?: 'minimum' | 'prorated';    // captured from table.rateCardBilling at session start
  isBackEntry?: boolean;                               // v12: true when logged via Back Entry flow, not live timer
  paymentBreakdown?: PaymentBreakdown;                 // v13: how the bill was paid; sum === session.amount + Σ(items).
                                                        //      Backfilled for completed sessions with { cash: amount, upi: 0, wallet: 0 } (items gap documented).
                                                        //      Undefined while running/paused — set at "Record payment" confirm (NOT at stopSession).
}

interface PaymentBreakdown {
  cash: number;        // integer rupees ≥ 0
  upi: number;         // integer rupees ≥ 0
  wallet: number;      // integer rupees ≥ 0
}

interface TableMove {
  fromTableId: number;
  toTableId: number;
  movedAt: number;   // Unix ms
}
```

### Customers Store (v5+, last updated v16)

```ts
// src/types/customer.ts
interface Customer {
  id: string                  // UUID v4, primary key (string, not auto-increment)
  phone: string | null        // "+91XXXXXXXXXX" (12 chars), null for walk-ins
  name: string | null         // optional display name
  walkInCode: string | null   // "WALK-001" etc., only when phone === null
  walletBalance: number       // integer rupees
  coinBalance?: number        // v15: ClubCoins; integer; undefined treated as 0 in all read paths
  createdAt: number           // Date.now()
  lastVisitAt: number         // updated on any topup or adjustment
  // v16: engagement timestamps — all optional, undefined = feature not yet triggered
  firstTopupAt?: number       // epoch ms; set on first confirmed topup; welcome bonus one-shot guard
  lastStreakBonusAt?: number   // epoch ms; last streak bonus award; streak cooldown guard
  expiryAppliedAt?: number    // epoch ms; last expiry sweep for this customer; 1h debounce guard
}
```

**Phone uniqueness:** enforced in `customerStore` layer (pre-check before write), NOT via Dexie `&phone` index. Reason: multiple `null` values (walk-ins) would violate a unique index in some browsers.

**Walk-in counter:** stored as `ClubSettings.walkInCounter?: number`. Treat missing as `0`. Counter increment + customer insert happen in one `db.transaction('rw', settings, customers)` — crash-safe.

### WalletTransactions Store (v5+, last updated v16)

```ts
// src/types/walletTransaction.ts
type WalletTransactionType = 'credit' | 'debit' | 'adjustment'
type WalletPaymentMode = 'cash' | 'upi' | 'card'
type WalletReferenceType =
  | 'topup' | 'session' | 'item' | 'manual' | 'refund'
  | 'canteen_sale'     // v13: walk-in canteen sale
  | 'coin_redemption'  // v15: coins redeemed at session/canteen payment
  | 'coin_expiry'      // v16: coins auto-expired after coinExpiryDays (FIFO)
  | 'welcome_bonus'    // v16: first-topup one-shot bonus
  | 'streak_bonus'     // v16: N distinct visit-days in window bonus
  | 'engagement_log'   // v16: zero-balance audit row when WhatsApp nudge sent

interface WalletTransaction {
  id: string                            // UUID v4
  customerId: string
  type: WalletTransactionType
  amount: number                        // always positive; 0 for coin-only rows
  balanceAfter: number                  // wallet OR coin balance after tx
  paymentMode: WalletPaymentMode | null // null for debit/adjustment/coin rows
  referenceType: WalletReferenceType | null
  referenceId: string | null            // sessionId / itemId / null
  notes: string | null                  // mandatory for 'adjustment' and 'refund'
  createdAt: number
  // v15: ClubCoins fields — undefined on all pre-v15 rows (backward compatible)
  balanceType?: 'wallet' | 'coins'      // undefined treated as 'wallet'
  coinDelta?: number                    // signed; positive = earned, negative = redeemed/expired. Only when balanceType='coins'
  rupeeEquivalent?: number              // ₹ value at coin consumption time (audit; rate may change later)
}
```

**Immutability rule:** WalletTransaction rows are NEVER updated. Corrections are new rows with `type: 'adjustment'` or `type: 'debit'` + `referenceType: 'refund'`. There is intentionally no `updateTransaction()` in `customerStore`.

**Compound index:** `[customerId+createdAt]` enables efficient reverse-chronological history queries per customer: `db.walletTransactions.where('[customerId+createdAt]').between([id, Dexie.minKey], [id, Dexie.maxKey]).reverse()`.

### canteenItems Store (v8+)

Master list of canteen items the club sells. Owner-curated. Used by `AddItemBottomSheet` to show tappable chips.

```ts
interface CanteenItem {
  id?: number              // auto-incremented primary key
  name: string             // 1-50 chars, alphanumeric + spaces + .-_; unique among active rows (case-insensitive enforced at write time)
  defaultPrice: number     // integer rupees, 1-9999
  stockEnabled: boolean    // if true, currentStock is tracked and decremented on session add
  currentStock: number | null  // integer ≥0 when stockEnabled; null when stockEnabled=false
  isActive: boolean        // soft-delete flag; false = hidden from default queries but row persists
  createdAt: number        // Date.now() at creation
  sortOrder: number        // ascending sort order in list display
}
```

**Indexes:** `++id, name, isActive, sortOrder`

**Boolean index quirk:** NEVER use `.where('isActive').equals(1)` — IndexedDB stores booleans as booleans, not integers. Always use `.filter(item => item.isActive === true)`. See Pattern D7 and B-canteen-2.

**Stock decrement atomicity:** In `AddItemBottomSheet`, stock decrement + `sessionItems.add()` happen in ONE flat `db.transaction('rw', db.canteenItems, db.sessionItems, ...)`. The logic is inlined — do NOT call `decrementCanteenItemStock()` (which has its own internal transaction) from inside an outer transaction. See Pattern D7.

### canteenSales Store (v13+)

Walk-in canteen sale — no table session. Atomic — one row written at confirm time. Stock decrements happen in the same Dexie tx.

```ts
interface CanteenSale {
  id: string                                                // UUID v4
  createdAt: number                                         // Unix ms
  items: Array<{
    name: string
    price: number                                           // integer rupees
    quantity: number                                        // integer ≥ 1
    canteenItemId?: number                                  // matched CanteenItem.id; absent for unmatched (v1: always matched — no free-text)
  }>
  subtotal: number                                          // Σ price*qty
  paymentBreakdown: PaymentBreakdown                        // sum === total
  total: number                                             // === subtotal in v1 (no discount)
  customerId?: string                                       // present only when wallet portion > 0
  notes?: string                                            // max 200 chars
}
```

**Indexes:** `id, createdAt, customerId`

**Atomicity:** `createCanteenSale()` opens a single flat `db.transaction('rw', db.canteenSales, db.canteenItems, db.customers, db.walletTransactions)`. Order: aggregate qty per canteenItemId → decrement stock per item (throws `CanteenSaleStockError` if would go negative) → wallet debit + WalletTransaction insert (if wallet > 0) → insert CanteenSale row LAST. Any earlier throw rolls everything back. Stock for `stockEnabled=false` items is NOT mutated but the sale still succeeds.

### stockPurchases Store (v13+)

Canteen restock log. Source `'piggy'` deducts from piggy balance; `'other'` does not.

```ts
interface StockPurchase {
  id: string                  // UUID v4
  canteenItemId: number       // FK → CanteenItem.id
  quantityAdded: number       // integer ≥ 1
  cost: number                // integer rupees ≥ 0 (total cost paid; NOT per unit)
  source: 'piggy' | 'other'
  createdAt: number           // Unix ms
  notes?: string              // max 200 chars
}
```

**Indexes:** `id, createdAt, canteenItemId, source`

**Atomicity:** `recordStockPurchase()` opens a single flat `db.transaction('rw', db.stockPurchases, db.canteenItems)`. Insert StockPurchase + (when `stockEnabled=true`) `currentStock += quantityAdded`. Stock can only grow via restock — never goes negative through this path.

### Settings Store (Singleton)

```ts
interface ClubSettings {
  id: 1;                    // always 1
  clubName: string;
  currency: '₹';            // locked for v1
  rounding: 'none' | '15min' | '30min';
  upiId?: string;
  walkInCounter?: number;   // treat missing as 0
  legacyAdjustmentsBackfilled?: boolean; // v6 migration audit flag
  alarmSoundEnabled?: boolean;    // v7: default true; stored in Dexie, NOT localStorage
  alarmVibrationEnabled?: boolean; // v7: default true; stored in Dexie, NOT localStorage
  lowStockThreshold?: number;     // v8: default 5
  piggyOpeningBalance?: number;   // v13: treat missing as 0
  piggyStartedAt?: number;        // v13: Unix ms; aggregation window start
  // v14: Player Hub
  slug?: string;                  // mirrors Supabase clubs.slug; undefined = hub not set up
  slugLocked?: boolean;           // true after first successful slug save; UI blocks edits
  // v15: ClubCoins
  acceptsTopups?: boolean;        // mirrors Supabase clubs.accepts_topups; treat missing as true
  coinRedemptionModes?: 'time' | 'canteen' | 'both'; // treat missing as 'both'
  coinsEnabled?: boolean;         // master switch; undefined/false = off
  coinTiers?: CoinTier[];         // { minAmount: number, coins: number }[]
  minutesPerCoin?: number;        // default 2
  rupeesPerCoin?: number;         // default 0.5
  coinExpiryDays?: number;        // default 60
  coinMinRedemption?: number;     // default 10 coins
  // v16: Engagement features — all off by default (undefined = off)
  welcomeBonusEnabled?: boolean;
  welcomeBonusCoins?: number;     // default 50
  streakEnabled?: boolean;
  streakRequiredDays?: number;    // default 3
  streakWindowDays?: number;      // default 7
  streakBonusCoins?: number;      // default 50
  dormancyEnabled?: boolean;
  dormantThresholdDays?: number;  // default 14
  nudgeTemplate?: string;         // WhatsApp message template with {name}/{coins}/{clubName} vars
}
```

### Piggy formula (computed live via `getPiggyBalance()`)

There is no piggy ledger table — the balance is derived from the existing
session/canteenSale/walletTransaction/stockPurchase rows, scoped to
`piggyStartedAt`. Single source of truth = those four tables + the
`piggyOpeningBalance` setting.

```
opening    = settings.piggyOpeningBalance ?? 0
since      = settings.piggyStartedAt ?? 0

cashIn     = Σ session.paymentBreakdown.cash       for completed sessions where endedAt >= since
           + Σ canteenSale.paymentBreakdown.cash   where createdAt >= since
           + Σ walletTransaction.amount            where type='credit' AND paymentMode='cash' AND createdAt >= since

restockOut = Σ stockPurchase.cost                  where source='piggy' AND createdAt >= since

current    = opening + cashIn − restockOut         // returned raw; UI clamps to ≥ 0 and shows warning when underlying < 0
```

**Wallet-credit-paid-in-cash is in piggy but NOT in PAYMENT MODE:** the cash
physically enters the till when a customer tops up via cash, so it counts
toward piggy. The PAYMENT MODE tile aggregates revenue (sessions + canteen
sales) only — top-ups are deposits, not revenue.

## Indexes Explained

- `tables`: `++id` (primary auto), `name`, `gameType`, `sortOrder`, `outOfService` — all queryable
- `sessions`: `++id`, `tableId` (find active session per table), `status` (filter by running/paused/completed), `startedAt` (date range queries), `endedAt`
- `settings`: just `id` because there's only ever one row

## Critical Invariants

These MUST hold at all times. If a change could break them, push back to Sugeet.

1. **Only ONE active session per table at any time.**
   - "Active" = status === 'running' OR 'paused'
   - Enforced in `startSession()` via pre-check
   - Race condition guarded by re-check on submit

2. **`startedAt` is immutable except via `editSessionStart()`.**
   - It's the audit trail. Never overwrite during normal flow.

3. **`pausedTotalMs` only grows, never decreases.**
   - On resume: `pausedTotalMs += (Date.now() - pausedAt)`, then `pausedAt = null`

4. **`amount` is set ONCE at stopSession.**
   - For running/paused sessions, calculate on-the-fly via `calculateAmount()` for display, but don't write to DB.

5. **`rateSnapshot` is taken at session start and never changes.**
   - If owner edits table's `ratePerHour` later, in-progress sessions keep their original rate. Only new sessions use the new rate.

6. **`outOfService:true` tables stay editable but don't accept new sessions.**
   - This is soft delete. Past sessions reference the table_id which still exists.

7. **Cannot disable a table with an active session.** (Added in Prompt 8.)

## Time Math

All time-related math is centralized in `src/lib/time.ts`. Never reimplement.

```ts
function getElapsedMs(session: Session): number {
  let elapsed: number;
  if (session.status === 'completed') {
    elapsed = (session.endedAt! - session.startedAt) - session.pausedTotalMs;
  } else if (session.status === 'paused') {
    elapsed = (session.pausedAt! - session.startedAt) - session.pausedTotalMs;
  } else {
    elapsed = (Date.now() - session.startedAt) - session.pausedTotalMs;
  }
  return Math.max(0, elapsed); // clock skew guard
}
```

## Money Math

In `src/lib/money.ts`. Dispatch order is critical — see ripple_effects.md.

```ts
function calculateAmount(session: Session, elapsedMs: number, rounding?: 'none'|'15min'|'30min'): number {
  // 1. Per-frame billing
  if (session.billingMode === 'per_frame') {
    return (session.framesPlayed ?? 0) * session.rateSnapshot;
  }

  // 2. Rate card billing (v10/v11) — rounding param IGNORED here (Pattern T8)
  if (session.rateCardSnapshot && session.rateCardSnapshot.length > 0) {
    const tol = session.toleranceMinutesSnapshot ?? 10;
    const mode = session.rateCardBillingSnapshot ?? 'prorated';
    return mode === 'minimum'
      ? priceForElapsedMinimum(elapsedMs, session.rateCardSnapshot, tol)
      : priceForElapsedProrated(elapsedMs, session.rateCardSnapshot, tol);
  }

  // 3. Legacy linear with optional rounding
  let effectiveMs = elapsedMs;
  if (rounding === '15min') effectiveMs = Math.ceil(elapsedMs / 900000) * 900000;
  else if (rounding === '30min') effectiveMs = Math.ceil(elapsedMs / 1800000) * 1800000;
  return Math.round((effectiveMs / 3600000) * session.rateSnapshot);
}
```

**Rounding only applies in `stopSession()`** — not during display while running. Rate card sessions ignore the rounding param entirely (tier + tolerance IS the rounding).

## Rate Card Billing Algorithms (v10/v11)

Two algorithms in `src/lib/money.ts`. Both return integer ₹. Both return 0 for `elapsedMs ≤ 0`.

### `priceForElapsedProrated(elapsedMs, tiers, toleranceMinutes)` — default

| Elapsed | Behavior |
|---|---|
| 0 | ₹0 |
| < tier1.minutes | Linear ramp: `round((em / tier1.minutes) × tier1.price)` |
| ≤ tier[i].minutes + tolerance | Plateau: `tier[i].price` |
| Between tiers (past plateau, before next tier start) | Linear interpolation between tier[i].price and tier[i+1].price |
| > last.minutes + tolerance | Extrapolate: `last.price + overflow × (last.price / last.minutes)` per minute |

**Key property:** Below tier 1, you pay proportionally — 15 min on a 30-min/₹100 card = ₹50. Fair for short plays.

### `priceForElapsedMinimum(elapsedMs, tiers, toleranceMinutes)` — opt-in

| Elapsed | Behavior |
|---|---|
| 0 | ₹0 |
| ≤ tier[i].minutes + tolerance | Charge tier[i].price (minimum charge, even for 1 minute) |
| > last.minutes + tolerance | `last.price + ceil(overflow) × perMinRate` |

**Key property:** Even 1 second on a 30-min/₹70 card = ₹70. Classic "minimum charge" behavior.

### Acceptance values (Ball Bender rate card: 30/70, 60/100, 90/170, 120/200, 150/270, 180/300, tolerance 10 min)

| Elapsed | Prorated | Minimum |
|---|---|---|
| 0 min | ₹0 | ₹0 |
| 1 min | ₹2 | ₹70 |
| 15 min | ₹35 | ₹70 |
| 30 min | ₹70 | ₹70 |
| 40 min | ₹70 | ₹70 |
| 41 min | ₹73 | ₹100 |
| 60 min | ₹100 | ₹100 |
| 70 min | ₹100 | ₹100 |
| 71 min | ₹112 | ₹170 |
| 90 min | ₹170 | ₹170 |
| 100 min | ₹170 | ₹170 |
| 101 min | ₹178 | ₹200 |
| 120 min | ₹200 | ₹200 |
| 130 min | ₹200 | ₹200 |
| 131 min | ₹211 | ₹270 |
| 150 min | ₹270 | ₹270 |
| 180 min | ₹300 | ₹300 |

## Migration Strategy

When schema needs to change:

1. Bump Dexie version: `this.version(3).stores({...})`
2. Add `.upgrade(tx => { ... })` if data needs transformation
3. Existing users open the app → Dexie auto-migrates on first load
4. Test by clearing IndexedDB and reseeding, also by upgrading from old schema

Example for v2 migration (already applied):
```ts
this.version(2).stores({
  tables: '++id, name, gameType, sortOrder, outOfService',
  sessions: '++id, tableId, status, startedAt, endedAt',
  settings: 'id',
}).upgrade(tx => {
  // Add roundedDurationMs field to existing sessions (optional, defaults undefined)
  // No actual data change needed — TypeScript optional means it's safe
});
```

## Data Export Format (v16 — current, fixed 14 Jun 2026, #78)

When exporting for backup (Settings → Data & Backup → Export everything), `getAllDataForExport()` in `src/db/queries.ts` returns ALL 9 Dexie stores plus a schema version and timestamp. Shape:

```ts
// Source of truth: ClubKeeperBackupV16 in src/db/queries.ts
interface ClubKeeperBackupV16 {
  schemaVersion: 16              // mirror of CURRENT_SCHEMA_VERSION in queries.ts
  exportedAt: number             // Date.now() at export time
  tables: GameTable[]            // db.gameTables
  sessions: Session[]            // db.sessions
  sessionItems: SessionItem[]    // db.sessionItems  (POS line items)
  settings: ClubSettings | undefined  // db.settings.get(1) — singleton row
  customers: Customer[]          // db.customers
  walletTransactions: WalletTransaction[]  // db.walletTransactions
  canteenItems: CanteenItem[]    // db.canteenItems  (master menu)
  canteenSales: CanteenSale[]    // db.canteenSales  (walk-in POS sales)
  stockPurchases: StockPurchase[] // db.stockPurchases  (piggy math depends on these)
}
```

### Why v16 reshape

Before #78 (fixed 14 Jun 2026), the export was a 3-key object: `{ tables, sessions, settings }` only. That format silently omitted 6 of 9 stores including all wallet customers, canteen items, canteen sales, walletTransactions, sessionItems, stockPurchases — a P0 data-loss bug. Any owner who exported and restored lost their entire customer wallet ledger and canteen history.

### Forward-compatibility rule

- `schemaVersion` MUST mirror the current Dexie version in `database.ts`. When you bump Dexie, also bump `CURRENT_SCHEMA_VERSION` in `queries.ts`. Pair commits.
- Import (#79) rejects any file with `schemaVersion > CURRENT_SCHEMA_VERSION` (forward-unknown) AND rejects any file without `schemaVersion` (legacy 3-table format — incomplete, never lossless).
- IDs (`id`, `tableId`, `sessionId`, `customerId`) MUST be preserved verbatim on import — foreign-key links across tables would break otherwise.

### Ripple — when you add a new Dexie table

1. Add it to `getAllDataForExport()` in `src/db/queries.ts` — every store in `ClubKeeperDB` must appear.
2. Add the corresponding field to `ClubKeeperBackupV16` interface (same file).
3. Bump `CURRENT_SCHEMA_VERSION` to match the new Dexie version.
4. Update the import side (Phase A of #79) — add the table to the clear+bulkAdd loop.
5. Update this section of `data_model.md`.

## Query Patterns

All queries in `src/db/queries.ts`. Common patterns:

```ts
// Get all active sessions
await db.sessions.where('status').notEqual('completed').toArray();

// Get sessions in date range
await db.sessions
  .where('startedAt')
  .between(startOfDay.getTime(), endOfDay.getTime())
  .toArray();

// Get active session for a specific table
await db.sessions
  .where('tableId').equals(tableId)
  .and(s => s.status !== 'completed')
  .first();
```

## When to Add Cloud Sync

NOT YET. Triggers for adding cloud:
- 3+ paying customers ask for multi-device access
- Customer reports lost data and refuses to use it again
- Need for analytics across customers

Until then: offline-only is a feature, not a bug. No latency, works on bad WiFi.
