# Data Model

> **Type authority:** the TypeScript interfaces in `src/types/index.ts`, `src/types/customer.ts`, `src/types/walletTransaction.ts`, `src/types/booking.ts`, `src/types/playerHub.ts` are the source of truth for row shapes. This file summarizes them and records the facts code can't express (version history, invariants, billing acceptance values, export contract). If this file and the code disagree, **the code wins** — and this file must be fixed in the same session (Rule B).

## Database: ClubKeeperDB (Dexie / IndexedDB)

Database name is `ClubKeeperDB_<userId>` (Supabase UUID) for per-user isolation. The `db` export is a Proxy over a re-openable instance — see `database.ts`. Never query before `dbReady === true` (Pattern D6).

### Schema Version History

| Version | When | What changed |
|---|---|---|
| v1 | Prompts 0–6 | `gameTables`, `sessions`, `settings` |
| v2 | Prompt 7 | Adds optional `roundedDurationMs` on sessions |
| v3 | 26 May 2026 | Adds `sessionItems: '++id, sessionId, addedAt'` |
| v4 | 27 May 2026 | Documents `upiId` on settings |
| v5 | 30 May 2026 | Adds `customers` + `walletTransactions` |
| v6 | 30 May 2026 | `.upgrade()` backfill of legacy `type:'adjustment'` wallet rows |
| v7 | 31 May 2026 | Session alarm fields (`notifyAtMs`, `notifyAcknowledgedAt`); alarm settings |
| v8 | 7 Jun 2026 | Adds `canteenItems`; `lowStockThreshold` |
| v9 | 8 Jun 2026 | Adds `Session.tableMoves?` |
| v10 | 9 Jun 2026 | `rateCard`/`toleranceMinutes` + session snapshots |
| v11 | 9 Jun 2026 | `rateCardBilling` + snapshot |
| v12 | 9 Jun 2026 | `Session.isBackEntry?` |
| v13 | 10 Jun 2026 | `canteenSales` + `stockPurchases` tables; `Session.paymentBreakdown?`; piggy settings; `.upgrade()` backfill (⚠ items-revenue gap, deferred) |
| v14 | 10–11 Jun 2026 | `ClubSettings.slug?/slugLocked?` (Player Hub) |
| v15 | 10–11 Jun 2026 | Coin fields on Customer/WalletTransaction/ClubSettings |
| v16 | 10–11 Jun 2026 | Engagement fields (`firstTopupAt` etc.) |
| v17 | 17 Jun 2026 | Adds `bookings: 'id, tableId, slotStart, status, [tableId+slotStart]'`; `acceptsBookings?/bookingAdvanceAmount?` (#84) |
| v18 | 19 Jun 2026 | Peak pricing: `CanteenItem.peakPrice?` + `ClubSettings.peakPricingEnabled?/peakStart*/peakEnd*` (#68). Additive, store strings identical to v17 |
| v19 | 22 Jun 2026 | Booking hours: `bookingOpenMinutes?/bookingCloseMinutes?/bookingAdvancePerSlot?`; `bookingAdvanceAmount` `@deprecated` (#106) |
| **v20** | **24 Jun 2026** | **UUID migration (Phase B).** 4 tables (`gameTables`, `sessions`, `sessionItems`, `canteenItems`) flip `++id` → `id` (caller-supplied UUID string). `.upgrade()` atomically rewrites all numeric-id rows to UUIDs, remaps all FK fields incl. nested `tableMoves[]`, stamps `_migrationSeq`. `_outbox` table added (Phase C queue). All `number \| string` unions collapsed to `string` |
| **v21** | **1 Jul 2026 (Chunk 5.0, 79892c8)** | **Current.** Store strings identical to v20; version bump alongside SyncReader (`settings.pullCursors` rides settings as additive field). `CURRENT_SCHEMA_VERSION = 21`; `ClubKeeperBackupV21` primary (V16–V20 aliased) |

### Current stores (v21 — verbatim from `src/db/database.ts`)

```ts
this.version(21).stores({
  gameTables: 'id, name, gameType, sortOrder, outOfService',
  sessions: 'id, tableId, status, startedAt, endedAt',
  settings: 'id',
  sessionItems: 'id, sessionId, addedAt',
  customers: 'id, phone, walkInCode, lastVisitAt',
  walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
  canteenItems: 'id, name, isActive, sortOrder',
  canteenSales: 'id, createdAt, customerId',
  stockPurchases: 'id, createdAt, canteenItemId, source',
  bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
  _outbox: '++seq, table, op, rowId, createdAt',
})
```

**ID rules (post-v20 — load-bearing):**
- ALL ten data tables use **string UUID primary keys** (settings is the singleton exception, `id: 1`; `_outbox` uses auto-inc `seq`).
- `.add()` on any UUID table requires a **caller-supplied `id: crypto.randomUUID()`** — the store string has no `++` (Pattern D12). Never rely on the `.add()` return value to obtain an id.
- **Never `Number()` a route param or row id** (Pattern R5). `useParams()` ids are UUID strings; validity check is `id.length === 36`.
- FK fields are all strings: `Session.tableId`, `SessionItem.sessionId`, `CanteenSale.items[].canteenItemId`, `StockPurchase.canteenItemId`, `Booking.tableId`, `Booking.consumedSessionId`, `TableMove.fromTableId/toTableId`.
- `_migrationSeq?: number` sits on rows of the 4 v20-migrated tables (Phase C resumable-upload ordering; not touched after migration).

**Sync (LWW) metadata (#117, Pattern S17):** the 8 mutable synced interfaces carry `updatedAt?: number` and `deletedAt?: number | null` — **camelCase epoch ms**, stamped by the sync wrappers and read mappers. ISO strings exist only at the Supabase wire boundary. `WalletTransaction` has neither (append-only ledger). Raw snake_case `updated_at`/`deleted_at` must never persist on a Dexie row.

### Key interfaces (summary — see `src/types/*.ts` for authority)

```ts
interface GameTable {
  id: string                // UUID (v20+)
  name: string; gameType: 'pool'|'snooker'|'carrom'|'playstation'|'other'
  ratePerHour: number; ratePerFrame?: number
  outOfService: boolean; createdAt: number; sortOrder: number
  rateCard?: RateTier[]; toleranceMinutes?: number
  rateCardBilling?: 'minimum' | 'prorated'
  _migrationSeq?: number; updatedAt?: number; deletedAt?: number | null
}

interface Session {
  id: string; tableId: string          // UUIDs (v20+)
  startedAt: number; endedAt: number | null
  pausedTotalMs: number; pausedAt: number | null
  billingMode: 'per_hour' | 'per_frame'; rateSnapshot: number
  playerName: string | null; playerCount: number; note: string | null
  framesPlayed: number | null
  status: 'running' | 'paused' | 'completed'
  amount: number; roundedDurationMs?: number
  notifyAtMs?: number | null; notifyAcknowledgedAt?: number | null
  tableMoves?: TableMove[]             // fromTableId/toTableId are strings (v20+)
  rateCardSnapshot?: RateTier[]        // Pattern T7 — triple always set together
  toleranceMinutesSnapshot?: number
  rateCardBillingSnapshot?: 'minimum' | 'prorated'
  isBackEntry?: boolean
  paymentBreakdown?: PaymentBreakdown  // set at Record-payment confirm, NOT at stopSession
  paymentInProgress?: boolean          // pause-first stop flow (Pattern P4)
  _migrationSeq?: number; updatedAt?: number; deletedAt?: number | null
}

interface Booking {                     // src/types/booking.ts — id IS the Supabase intent UUID
  id: string; tableId: string
  playerName: string | null; playerPhone: string
  slotStart: number; slotEnd: number; durationMin: number   // Unix ms (Pattern T1)
  gameType: GameType; tierPrice: number; advanceAmount: number
  status: 'confirmed' | 'consumed' | 'no_show' | 'cancelled' // NO 'pending' in Dexie — hybrid postbox
  consumedSessionId?: string; confirmedAt: number; notes?: string
  updatedAt?: number; deletedAt?: number | null
}

interface OutboxRow {                   // Phase C sync queue (client-only, never synced itself)
  seq?: number; idempotencyKey: string
  table: SyncTableName                  // snake_case Supabase name
  op: 'insert' | 'update' | 'soft_delete'
  rowId: string; payload: unknown       // full merged row; soft_delete: { deletedAt: ms }
  attempts: number; lastError: string | null; lastAttemptAt: number | null
  createdAt: number; stuck?: boolean    // dead-letter at >=10 attempts; skipped, not deleted
}
```

`Customer`, `WalletTransaction`, `CanteenItem`, `CanteenSale`, `StockPurchase`, `ClubSettings` — see their type files; shapes unchanged from their introduction versions apart from the LWW metadata fields and the string-FK collapse above.

**Phone uniqueness:** enforced in `customerStore` (pre-check + `DuplicatePhoneError`), NOT via a Dexie `&phone` unique index (multiple null walk-ins would violate it). Do not "fix" by adding `&phone`.

**Walk-in counter:** `ClubSettings.walkInCounter?` — missing = 0; counter increment + customer insert share one tx.

**WalletTransaction immutability:** rows are NEVER updated. Corrections = new rows. No `updateTransaction()` exists — do not add one. Sync-side: `soft_delete` on `wallet_transactions` THROWS (append-only, §4.6 of the sync doc).

### ClubSettings (singleton, id = 1) — field groups by version

Core: `clubName`, `currency: '₹'`, `rounding: 'none'|'15min'|'30min'`, `upiId?`, `walkInCounter?`, `legacyAdjustmentsBackfilled?`.
v7 alarm: `alarmSoundEnabled?`, `alarmVibrationEnabled?`. v8: `lowStockThreshold?` (default 5). v13 piggy: `piggyOpeningBalance?`, `piggyStartedAt?`. v14 hub: `slug?`, `slugLocked?`. v15 coins: `acceptsTopups?`, `coinsEnabled?`, `coinTiers?`, `minutesPerCoin?`, `rupeesPerCoin?`, `coinExpiryDays?`, `coinMinRedemption?`, `coinRedemptionModes?`. v16 engagement: `welcomeBonusEnabled?/welcomeBonusCoins?/streakEnabled?/streakRequiredDays?/streakWindowDays?/streakBonusCoins?/dormancyEnabled?/dormantThresholdDays?/nudgeTemplate?`. v17–v19 booking: `acceptsBookings?`, `bookingAdvanceAmount?` (**@deprecated 22 Jun 2026** — frozen, no reads for new bookings), `bookingOpenMinutes?`, `bookingCloseMinutes?`, `bookingAdvancePerSlot?` (default 50). v18 peak: `peakPricingEnabled?`, `peakStartHour?/Minute?`, `peakEndHour?/Minute?`. Phase C: `pullCursors?` (per-table sync read cursors — written ONLY by SyncReader's serialized worker).

Reads go through `useDexieSetting` ONLY (Critical Rule 14, Pattern R4, enforced by `npm run check:settings`).

### Piggy formula (computed live via `getPiggyBalance()` — Pattern P6)

No piggy ledger table; the balance derives from existing rows, scoped to `piggyStartedAt`:

```
opening    = settings.piggyOpeningBalance ?? 0
since      = settings.piggyStartedAt ?? 0
cashIn     = Σ session.paymentBreakdown.cash     (completed, endedAt >= since)
           + Σ canteenSale.paymentBreakdown.cash (createdAt >= since)
           + Σ walletTransaction.amount          (type='credit', paymentMode='cash', createdAt >= since)
restockOut = Σ stockPurchase.cost                (source='piggy', createdAt >= since)
current    = opening + cashIn − restockOut       // UI clamps to ≥0 + warning
```

Cash wallet top-ups count toward piggy (cash in till) but NOT toward PAYMENT MODE (deposits ≠ revenue).

## Critical Invariants

1. **Only ONE active session per table** ("active" = running OR paused). Pre-check + re-check in `startSession()`.
2. **`startedAt` immutable** except via `editSessionStart()`.
3. **`pausedTotalMs` only grows.**
4. **`amount` set once** at stop; display values computed on the fly.
5. **`rateSnapshot` captured at start, never changes** (Pattern T3). Rate-card snapshots are a triple set together (Pattern T7).
6. **`outOfService:true` = soft delete** — editable, no new sessions, history intact.
7. **Cannot disable a table with an active session.**

## Time Math

Centralized in `src/lib/time.ts`. Never reimplement.

```ts
function getElapsedMs(session: Session): number {
  let elapsed: number;
  if (session.status === 'completed')      elapsed = (session.endedAt! - session.startedAt) - session.pausedTotalMs;
  else if (session.status === 'paused')    elapsed = (session.pausedAt! - session.startedAt) - session.pausedTotalMs;
  else                                     elapsed = (Date.now() - session.startedAt) - session.pausedTotalMs;
  return Math.max(0, elapsed); // clock skew guard
}
```

## Money Math

In `src/lib/money.ts`. Dispatch order is load-bearing (Pattern T8):

```ts
function calculateAmount(session, elapsedMs, rounding?) {
  // 1. per_frame → frames × rateSnapshot, return
  // 2. rateCardSnapshot non-empty → prorated|minimum via rateCardBillingSnapshot ?? 'prorated',
  //    tolerance ?? 10 — rounding param NEVER read here, return
  // 3. legacy linear: optional 15/30-min ceil rounding, then hours × rateSnapshot
}
```

Rounding applies only in `stopSession()`/stop-preview (identical inputs at both call sites), never during running display, never on rate-card sessions.

## Rate Card Billing Algorithms (v10/v11)

Both in `src/lib/money.ts`; both return integer ₹; both return 0 for `elapsedMs ≤ 0`.

**`priceForElapsedProrated(elapsedMs, tiers, toleranceMinutes)` — default:** below tier 1 = linear ramp to tier1.price; within `tier[i].minutes + tolerance` = plateau at tier[i].price; between tiers = linear interpolation; past last tier + tolerance = extrapolate at `last.price / last.minutes` per minute.

**`priceForElapsedMinimum(...)` — opt-in:** first tier where `ceil(em/min) ≤ tier.minutes + tolerance` wins (minimum charge even for 1 min); overflow past last = `last.price + ceil(overflow) × perMinRate`.

### Acceptance values (canonical card: 30/70, 60/100, 90/170, 120/200, 150/270, 180/300, tolerance 10)

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

1. Bump Dexie version with a new `this.version(N).stores({...})` block — never edit prior blocks.
2. `.upgrade(tx => {...})` only when data must transform; additive optional fields need no callback.
3. Same commit MUST bump `CURRENT_SCHEMA_VERSION` in `queries.ts` and, if a store was added, update `getAllDataForExport` + `importEverythingFromFile` + `resetEverything` + the round-trip self-test (Pattern D10 — three-way drift = silent data loss; see #78, #81).
4. Test both paths: fresh DB and upgrade-from-previous.

## Data Export Format (V21 — `ClubKeeperBackupV21`)

`getAllDataForExport()` returns ALL 10 data stores + `schemaVersion: 21` + `exportedAt`. `ClubKeeperBackupV21` in `src/db/queries.ts` is the source of truth; `V16`–`V20` are structural aliases (backups from those versions import cleanly). Import rejects `schemaVersion > CURRENT_SCHEMA_VERSION` and legacy 3-table files (`legacy_incomplete_format`). IDs are preserved verbatim across export→import — never regenerate (FK links break).

### Ripple — when you add a new Dexie store

1. `getAllDataForExport()` + backup interface + `CURRENT_SCHEMA_VERSION` bump.
2. Import side: tx table list + clear Promise.all + bulkAdd + `requiredArrayKeys`.
3. `resetEverything()` clear list.
4. Round-trip self-test snapshot measure.
5. If the store should SYNC: `SyncTableName` union, both maps in `syncTableMap.ts`, `SYNC_TABLES_PULL_ORDER`, a `CHANNEL_GROUPS` slot, mappers in BOTH `syncPayloadMapper.ts` and `syncReadMapper.ts`, `cursorColumnFor()` if append-only — see ripple_effects.md §Sync.
6. Update this file.

## Query Patterns

All queries in `src/db/queries.ts`. Ids are UUID strings post-v20:

```ts
await db.sessions.where('status').notEqual('completed').toArray();
await db.sessions.where('startedAt').between(startOfDay.getTime(), endOfDay.getTime()).toArray();
await db.sessions.where('tableId').equals(tableId /* string UUID */).and(s => s.status !== 'completed').first();
```

Boolean fields: use `.filter(r => r.bool === true)`, never `.equals(1)` (Pattern D9).

## Cloud sync status

Multi-device sync is **shipped and live** (Phase C — outbox write path + SyncReader read path + realtime + polling fallback). See `ripple_effects.md` §Sync for the working contract and `bug_patterns.md` S14–S24 for the hard-won rules. The original design doc (`history/sync_architecture_v2.md`) is design history — where it conflicts with shipped code, the code wins.
