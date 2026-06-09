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
| **v12** | **9 Jun 2026** | **Additive: adds optional `isBackEntry?: boolean` on sessions. No new index. No `.upgrade()`. Current version.** |

### Schema Version 12 (current)

```ts
this.version(12).stores({
  gameTables: '++id, name, gameType, sortOrder, outOfService',
  sessions: '++id, tableId, status, startedAt, endedAt',
  settings: 'id',
  sessionItems: '++id, sessionId, addedAt',
  customers: 'id, phone, walkInCode, lastVisitAt',
  walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
  canteenItems: '++id, name, isActive, sortOrder',
})
// v10, v11, and v12 are field-only additions — no new indexes, no .upgrade() block needed.
// Existing rows read undefined for new fields, which calculates correctly via ?? fallbacks.
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
}

interface TableMove {
  fromTableId: number;
  toTableId: number;
  movedAt: number;   // Unix ms
}
```

### Customers Store (v5+)

```ts
// src/types/customer.ts
interface Customer {
  id: string               // UUID v4, primary key (string, not auto-increment)
  phone: string | null     // "+91XXXXXXXXXX" (12 chars), null for walk-ins
  name: string | null      // optional
  walkInCode: string | null // "WALK-001" etc., only when phone === null
  walletBalance: number    // integer rupees (matches existing money convention)
  createdAt: number        // Date.now()
  lastVisitAt: number      // updated on any topup or adjustment
}
```

**Phone uniqueness:** enforced in `customerStore` layer (pre-check before write), NOT via Dexie `&phone` index. Reason: multiple `null` values (walk-ins) would violate a unique index in some browsers.

**Walk-in counter:** stored as `ClubSettings.walkInCounter?: number`. Treat missing as `0`. Counter increment + customer insert happen in one `db.transaction('rw', settings, customers)` — crash-safe.

### WalletTransactions Store (v5+)

```ts
// src/types/walletTransaction.ts
interface WalletTransaction {
  id: string                            // UUID v4
  customerId: string
  type: 'credit' | 'debit' | 'adjustment'
  amount: number                        // always positive; type indicates direction
  balanceAfter: number                  // balance snapshot after this tx (audit trail)
  paymentMode: 'cash' | 'upi' | 'card' | null  // null for debit/adjustment
  referenceType: 'topup' | 'session' | 'item' | 'manual' | 'refund' | null
  referenceId: string | null            // sessionId.toString() / itemId / null
  notes: string | null                  // mandatory for 'adjustment' and 'refund'
  createdAt: number
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

### Settings Store (Singleton)

```ts
interface ClubSettings {
  id: 1;                    // always 1
  clubName: string;
  currency: '₹';            // locked for v1
  rounding: 'none' | '15min' | '30min';
  upiId?: string;           // optional UPI ID for payment QR
  walkInCounter?: number;   // treat missing as 0
  legacyAdjustmentsBackfilled?: boolean; // v6 migration audit flag
  alarmSoundEnabled?: boolean;    // v7: default true; stored in Dexie, NOT localStorage
  alarmVibrationEnabled?: boolean; // v7: default true; stored in Dexie, NOT localStorage
  lowStockThreshold?: number;     // v8: default 5 if missing; triggers low-stock pill/toast
}
```

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

## Data Export Format

When exporting for backup (Settings → Export All Data):

```json
{
  "version": 2,
  "exportedAt": 1716123456789,
  "clubName": "My Club",
  "tables": [...],
  "sessions": [...],
  "settings": {...}
}
```

Future: implement Import that reads this format and restores data.

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
