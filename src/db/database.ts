import Dexie, { type Table } from 'dexie'
import type {
  GameTable,
  Session,
  ClubSettings,
  SessionItem,
  CanteenItem,
  CanteenSale,
  StockPurchase,
  OutboxRow,
} from '../types'
import type { Customer } from '../types/customer'
import type { WalletTransaction } from '../types/walletTransaction'
import type { Booking } from '../types/booking'

// ─── Per-user DB class ────────────────────────────────────────────────────────
// Database name is `ClubKeeperDB_<userId>` so two different Google accounts
// on the same browser never share IndexedDB data (LIMIT-001 band-aid).
// The old `ClubKeeperDB` (no suffix) is intentionally left untouched on disk
// so a one-time migration can be written later if needed.

export class ClubKeeperDB extends Dexie {
  // Transitional: number on v19 (++id), string UUID on v20 — TODO(phase-b-step-2): narrow to string after .upgrade()
  gameTables!: Table<GameTable, number | string>
  sessions!: Table<Session, number | string>
  sessionItems!: Table<SessionItem, number | string>
  canteenItems!: Table<CanteenItem, number | string>
  // Already string id from v5/v13/v17 — no change
  settings!: Table<ClubSettings, number>
  customers!: Table<Customer, string>
  walletTransactions!: Table<WalletTransaction, string>
  canteenSales!: Table<CanteenSale, string>
  stockPurchases!: Table<StockPurchase, string>
  bookings!: Table<Booking, string>
  // Phase C sync queue — local-only, never exported, unused until Phase C
  _outbox!: Table<OutboxRow, number>

  constructor(dbName: string) {
    super(dbName)
    // Version 1 kept for upgrade path (no migration callback needed)
    this.version(1).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
    })
    // Version 2: adds optional roundedDurationMs field to sessions (no index change)
    this.version(2).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
    })
    // Version 3: adds sessionItems table for POS (snacks/drinks/etc per session)
    this.version(3).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
    })
    // Version 4: same indexes as v3; documents optional upiId field on settings
    // (no index needed — field is read-only from settings singleton row)
    this.version(4).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
    })
    // Version 5: adds customers + walletTransactions tables for wallet/prepaid feature.
    // No .upgrade() callback — purely additive, existing rows untouched.
    // Phone uniqueness is enforced in customerStore layer, NOT via Dexie &phone index,
    // because IndexedDB unique index behaviour with multiple null values is not
    // guaranteed across browsers. The store checks for duplicates before write.
    // walkInCounter is stored on the settings singleton (no separate table).
    // Existing settings rows missing walkInCounter are treated as 0 at read time.
    this.version(5).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
    })
    // Version 6: one-time backfill of legacy walletTransaction rows where type='adjustment'.
    // Before this fix, manual adjustments were stored with type:'adjustment' instead of
    // type:'credit' or type:'debit', so TransactionRow couldn't determine sign or color.
    // The .upgrade() callback runs exactly once per user (only v5→v6 upgrade path).
    // Direction is inferred by comparing each row's balanceAfter to the preceding row's
    // balanceAfter for the same customer (ordered by createdAt). If it's the first row
    // for a customer, compare to 0 (starting balance before any transaction).
    // settings.legacyAdjustmentsBackfilled is set as an observable audit flag.
    // No store string changes — same schema as v5.
    this.version(6).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
    }).upgrade(async (tx) => {
      const txTable = tx.table<WalletTransaction, string>('walletTransactions')
      const settingsTable = tx.table<ClubSettings, number>('settings')

      // Find all legacy adjustment rows
      const legacyRows = await txTable
        .filter((row) => (row.type as string) === 'adjustment')
        .toArray()

      for (const row of legacyRows) {
        // Get all prior transactions for this customer, ordered by createdAt ascending
        const preceding = await txTable
          .where('[customerId+createdAt]')
          .below([row.customerId, row.createdAt])
          .filter((r) => r.customerId === row.customerId)
          .last()

        const previousBalance = preceding?.balanceAfter ?? 0
        const inferredType: 'credit' | 'debit' =
          row.balanceAfter >= previousBalance ? 'credit' : 'debit'

        await txTable.update(row.id, {
          type: inferredType,
          referenceType: 'manual',
        })
      }

      // Mark migration complete (audit trail — .upgrade() already guarantees once-only)
      await settingsTable.update(1, { legacyAdjustmentsBackfilled: true })
    })
    // Version 7: adds optional alarm fields to sessions — notifyAtMs and notifyAcknowledgedAt.
    // No .upgrade() needed — optional fields default to undefined on existing rows,
    // which is treated as "no alarm set". No new index needed — alarm check filters
    // in memory from already-loaded active sessions (never more than a handful at once).
    this.version(7).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
    })
    // Version 8: adds canteenItems table for canteen/snack menu management.
    // No .upgrade() needed — new table starts empty. lowStockThreshold field on
    // ClubSettings is optional; missing values are treated as 5 at read time.
    this.version(8).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
    })
    // Version 9: adds optional tableMoves field to sessions for table-move feature.
    // No .upgrade() needed — field is optional; existing rows without it are treated
    // as zero moves (undefined === no moves made). No new index required — moves are
    // always accessed via the parent session, never queried independently.
    this.version(9).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
    })
    // Version 10: adds optional rateCard + toleranceMinutes to gameTables, and
    // rateCardSnapshot + toleranceMinutesSnapshot to sessions (rate card billing).
    // No .upgrade() needed — all fields are optional; existing rows with undefined
    // fall back to linear ₹/hr billing (Pattern T3 invariant preserved).
    this.version(10).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
    })
    // Version 11: adds optional rateCardBilling to gameTables and
    // rateCardBillingSnapshot to sessions ('minimum' | 'prorated' billing modes).
    // No .upgrade() needed — undefined falls back to 'prorated' at read time.
    this.version(11).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
    })
    // Version 12: additive — adds optional `isBackEntry?: boolean` on sessions.
    // No new index. No .upgrade() callback. Legacy rows read undefined (falsy).
    this.version(12).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
    })
    // Version 13: split payments + walk-in canteen sale + piggy bank.
    // Adds:
    //  - canteenSales table (walk-in / direct canteen sale, no table session)
    //  - stockPurchases table (canteen restock log; source 'piggy' | 'other')
    //  - Session.paymentBreakdown (optional; populated for stopped sessions by upgrade)
    //  - ClubSettings.piggyOpeningBalance (default 0), piggyStartedAt (set to now if missing)
    // .upgrade() backfills paymentBreakdown for every completed session as
    // { cash: amount, upi: 0, wallet: 0 } (assume historic was all-cash) and
    // initialises piggy settings if absent. Running sessions are left untouched —
    // their breakdown is set at stopSession in Phase 2.
    this.version(13)
      .stores({
        gameTables: '++id, name, gameType, sortOrder, outOfService',
        sessions: '++id, tableId, status, startedAt, endedAt',
        settings: 'id',
        sessionItems: '++id, sessionId, addedAt',
        customers: 'id, phone, walkInCode, lastVisitAt',
        walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
        canteenItems: '++id, name, isActive, sortOrder',
        canteenSales: 'id, createdAt, customerId',
        stockPurchases: 'id, createdAt, canteenItemId, source',
      })
      .upgrade(async (tx) => {
        const sessionsTable = tx.table<Session, number>('sessions')
        const settingsTable = tx.table<ClubSettings, number>('settings')

        // Backfill paymentBreakdown for completed sessions only.
        // Existing payments were entirely cash before split-payment support.
        const completed = await sessionsTable
          .filter((s) => s.endedAt !== null && s.paymentBreakdown === undefined)
          .toArray()
        for (const s of completed) {
          if (s.id === undefined) continue
          await sessionsTable.update(s.id, {
            paymentBreakdown: {
              cash: s.amount ?? 0,
              upi: 0,
              wallet: 0,
            },
          })
        }

        // Initialise piggy settings if absent. Do not overwrite owner-set values.
        const settingsRow = await settingsTable.get(1)
        if (settingsRow) {
          const patch: Partial<ClubSettings> = {}
          if (settingsRow.piggyOpeningBalance === undefined) patch.piggyOpeningBalance = 0
          if (settingsRow.piggyStartedAt === undefined) patch.piggyStartedAt = Date.now()
          if (Object.keys(patch).length > 0) {
            await settingsTable.update(1, patch)
          }
        }
      })
    // Version 14: additive — adds optional `slug?: string` and `slugLocked?: boolean`
    // to ClubSettings for Player Hub. No new index. No .upgrade() callback.
    // Legacy rows read undefined for both fields (falsy = hub not set up yet).
    this.version(14).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
    })
    // Version 15: ClubCoins — additive only, no .upgrade() block.
    // Adds optional fields:
    //   Customer.coinBalance?: number            (undefined treated as 0)
    //   WalletTransaction.balanceType?: 'wallet'|'coins' (undefined treated as 'wallet')
    //   WalletTransaction.coinDelta?: number     (only set when balanceType='coins')
    //   WalletTransaction.rupeeEquivalent?: number (only set on redemption rows)
    //   ClubSettings coin config fields: coinsEnabled, coinTiers, minutesPerCoin,
    //     rupeesPerCoin, coinExpiryDays, coinMinRedemption
    // No new Dexie indexes — balanceType and coinDelta are NOT indexed
    // (post-fetch .filter() used for coin history, as documented in build prompt).
    // Schema string identical to v14 — no index changes needed.
    this.version(15).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
    })
    // Version 16: Engagement features (Phase 3) — additive only, no .upgrade() block.
    // Adds optional fields to Customer:
    //   firstTopupAt?: number    — epoch ms; set on first confirmed topup; welcome bonus one-shot guard
    //   lastStreakBonusAt?: number — epoch ms; streak cooldown guard
    //   expiryAppliedAt?: number  — epoch ms; per-customer expiry debounce
    // Adds optional fields to ClubSettings:
    //   welcomeBonusEnabled, welcomeBonusCoins, streakEnabled, streakRequiredDays,
    //   streakWindowDays, streakBonusCoins, dormancyEnabled, dormantThresholdDays, nudgeTemplate
    // WalletReferenceType extended with: coin_expiry, welcome_bonus, streak_bonus, engagement_log
    // No new Dexie indexes — all new fields read via .filter() or direct .get().
    // Schema string identical to v15 — no index changes needed.
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
    })
    // Version 17: Advance booking (Phase 1 of #84) — additive only, no .upgrade().
    // Adds bookings store. Permanent owner-side record of CONFIRMED player
    // advance bookings. Pending intents live ONLY in Supabase (booking_intents).
    // Indexes: tableId for /bookings agenda (per-table timeline), slotStart for
    // window queries (StartSession ±30 min linkage lookup), status for filtering
    // active vs consumed/cancelled. Compound [tableId+slotStart] for the most
    // common query: "any confirmed booking on this table within ±30 min of now?"
    // — Pattern T4 compliant when consumed from useLiveQuery.
    // Adds optional ClubSettings.acceptsBookings + ClubSettings.bookingAdvanceAmount.
    this.version(17).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
      bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
    })
    // Version 18: Peak Hour Pricing (#68) — additive only, no .upgrade() block.
    // Adds optional fields:
    //   CanteenItem.peakPrice?: number               (undefined = no peak price for this item)
    //   ClubSettings.peakPricingEnabled?: boolean    (undefined/false = feature off, default)
    //   ClubSettings.peakStartHour?: number          (0-23, default 22)
    //   ClubSettings.peakStartMinute?: number        (0-59, default 0)
    //   ClubSettings.peakEndHour?: number            (0-23, default 6)
    //   ClubSettings.peakEndMinute?: number          (0-59, default 0)
    // No new indexes — peakPrice is read alongside the item, never queried.
    // Schema string identical to v17 — no index changes needed.
    this.version(18).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
      bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
    })
    // Version 19: per-club operating hours + per-30-min-slot advance (#106) —
    // additive only, no .upgrade(). Adds optional fields to ClubSettings:
    //   bookingOpenMinutes?, bookingCloseMinutes?, bookingAdvancePerSlot?
    // Legacy bookingAdvanceAmount stays as @deprecated — never written by new UI,
    // never read for new bookings, but kept on the row for back-compat.
    // Schema string identical to v18 — no index changes.
    this.version(19).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: '++id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]',
      canteenItems: '++id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
      bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
    })
    // Version 20: UUID migration — PHASE B STEP 1 (schema only, no .upgrade() yet).
    // The 4 ++id tables flip to caller-supplied string id. Step 2 (next session)
    // adds the .upgrade() callback that actually rewrites existing rows.
    // Until Step 2 ships, this is a no-op upgrade — existing rows keep their
    // numeric ids in IndexedDB, and the app continues to use them.
    // Also adds _outbox table for Phase C sync (no Phase B logic uses it yet).
    this.version(20).stores({
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
  }
}

// ─── Mutable holder ───────────────────────────────────────────────────────────
// All consumers `import { db }` — the underlying instance swaps when the user
// signs in / out / switches accounts. Starts as a "pending" placeholder so
// the Proxy export always has something to forward to (no null-checks needed
// in callers). The router gates rendering on `dbReady` (see authStore) so
// real Dexie ops never hit the placeholder.

let _db: ClubKeeperDB = new ClubKeeperDB('ClubKeeperDB__pending')

// ─── Proxy export — `db` ─────────────────────────────────────────────────────
// All 30+ consumers keep `import { db } from '@/db/database'` unchanged.
// Property accesses (db.gameTables, db.sessions, etc.) forward to whatever
// _db currently points at.

export const db = new Proxy({} as ClubKeeperDB, {
  get(_target, prop: string | symbol): unknown {
    return _db[prop as keyof ClubKeeperDB]
  },
})

// ─── Lifecycle helpers (called by authStore only) ─────────────────────────────

export function getDbName(userId: string): string {
  return `ClubKeeperDB_${userId}`
}

export async function initDbForUser(userId: string): Promise<void> {
  const targetName = getDbName(userId)
  // No-op if already open on the correct DB (Pattern A1: avoids INITIAL_SESSION
  // re-fire from triggering a spurious close/reopen while a session is active).
  if (_db.name === targetName && _db.isOpen()) return
  if (_db.isOpen()) _db.close()
  _db = new ClubKeeperDB(targetName)
  await _db.open()
}

export async function closeDb(): Promise<void> {
  if (_db.isOpen()) _db.close()
  // Reset to placeholder so any accidental post-signout query hits a named,
  // inspectable DB rather than crashing with "Cannot read property of null".
  _db = new ClubKeeperDB('ClubKeeperDB__pending')
}

export function isDbReadyForUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return _db.name === getDbName(userId) && _db.isOpen()
}
