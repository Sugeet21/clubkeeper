import Dexie, { type Table } from 'dexie'
import type {
  GameTable,
  Session,
  ClubSettings,
  SessionItem,
  CanteenItem,
  CanteenSale,
  StockPurchase,
  RestockDraft,
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
  gameTables!: Table<GameTable, string>
  sessions!: Table<Session, string>
  sessionItems!: Table<SessionItem, string>
  canteenItems!: Table<CanteenItem, string>
  // Already string id from v5/v13/v17 — no change
  settings!: Table<ClubSettings, number>
  customers!: Table<Customer, string>
  walletTransactions!: Table<WalletTransaction, string>
  canteenSales!: Table<CanteenSale, string>
  stockPurchases!: Table<StockPurchase, string>
  bookings!: Table<Booking, string>
  // Phase C sync queue — local-only, never exported, unused until Phase C
  _outbox!: Table<OutboxRow, number>
  // #173 — bulk-restock draft (R6). Local-only, singleton row, never synced.
  restockDrafts!: Table<RestockDraft, number>

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
    // Version 20: UUID migration — PHASE B STEP 2 (schema + .upgrade() callback).
    // The 4 ++id tables flip to caller-supplied string id. The .upgrade() callback
    // rewrites all existing numeric-id rows to UUIDs in a single atomic Dexie
    // transaction. If the upgrade throws, Dexie rolls back and the user stays on v19.
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
    }).upgrade(async (tx) => {
      // Phase 1: build numeric-id → UUID maps for the 4 migrated tables.
      const idMaps = {
        gameTables:   new Map<number, string>(),
        sessions:     new Map<number, string>(),
        sessionItems: new Map<number, string>(),
        canteenItems: new Map<number, string>(),
      }
      for (const tableName of ['gameTables', 'sessions', 'sessionItems', 'canteenItems'] as const) {
        await tx.table(tableName).toCollection().each((row: { id: number }) => {
          if (typeof row.id === 'number') {
            idMaps[tableName].set(row.id, crypto.randomUUID())
          }
        })
      }

      // Phase 2: rewrite each migrated table. clear() + add() inside the same tx
      // so it's atomic. Order: catalog first (gameTables, canteenItems), then
      // operational (sessions — FK tableId, sessionItems — FKs sessionId+canteenItemId).
      let migrationSeq = 0

      // gameTables — no FKs to other migrated tables
      const allTables = await tx.table('gameTables').toArray()
      await tx.table('gameTables').clear()
      for (const r of allTables) {
        if (typeof r.id !== 'number') {
          await tx.table('gameTables').add({ ...r, _migrationSeq: ++migrationSeq })
          continue
        }
        await tx.table('gameTables').add({
          ...r,
          id: idMaps.gameTables.get(r.id) ?? crypto.randomUUID(),
          _migrationSeq: ++migrationSeq,
        })
      }

      // canteenItems — no FKs to other migrated tables
      const allCanteenItems = await tx.table('canteenItems').toArray()
      await tx.table('canteenItems').clear()
      for (const r of allCanteenItems) {
        if (typeof r.id !== 'number') {
          await tx.table('canteenItems').add({ ...r, _migrationSeq: ++migrationSeq })
          continue
        }
        await tx.table('canteenItems').add({
          ...r,
          id: idMaps.canteenItems.get(r.id) ?? crypto.randomUUID(),
          _migrationSeq: ++migrationSeq,
        })
      }

      // sessions — FK: tableId → gameTables; nested tableMoves[].fromTableId + .toTableId
      const allSessions = await tx.table('sessions').toArray()
      await tx.table('sessions').clear()
      for (const r of allSessions) {
        const newId = typeof r.id === 'number'
          ? (idMaps.sessions.get(r.id) ?? crypto.randomUUID())
          : r.id
        const newTableId = typeof r.tableId === 'number'
          ? (idMaps.gameTables.get(r.tableId) ?? String(r.tableId))
          : r.tableId
        // Remap nested tableMoves FK fields (§5.6 landmine 2c)
        const newTableMoves = Array.isArray(r.tableMoves)
          ? r.tableMoves.map((move: { fromTableId: number | string; toTableId: number | string; movedAt: number }) => ({
              ...move,
              fromTableId: typeof move.fromTableId === 'number'
                ? (idMaps.gameTables.get(move.fromTableId) ?? String(move.fromTableId))
                : move.fromTableId,
              toTableId: typeof move.toTableId === 'number'
                ? (idMaps.gameTables.get(move.toTableId) ?? String(move.toTableId))
                : move.toTableId,
            }))
          : r.tableMoves
        await tx.table('sessions').add({
          ...r,
          id: newId,
          tableId: newTableId,
          tableMoves: newTableMoves,
          _migrationSeq: ++migrationSeq,
        })
      }

      // sessionItems — FKs: sessionId → sessions, canteenItemId → canteenItems
      const allSessionItems = await tx.table('sessionItems').toArray()
      await tx.table('sessionItems').clear()
      for (const r of allSessionItems) {
        const newId = typeof r.id === 'number'
          ? (idMaps.sessionItems.get(r.id) ?? crypto.randomUUID())
          : r.id
        const newSessionId = typeof r.sessionId === 'number'
          ? (idMaps.sessions.get(r.sessionId) ?? String(r.sessionId))
          : r.sessionId
        await tx.table('sessionItems').add({
          ...r,
          id: newId,
          sessionId: newSessionId,
          _migrationSeq: ++migrationSeq,
        })
      }

      // Phase 3: rewrite FK fields in the 5 already-UUID tables that point into
      // migrated tables. Use .update() (cheaper than clear+add) since their own ids
      // don't change.

      // canteenSales — inline items array contains canteenItemId FK
      await tx.table('canteenSales').toCollection().modify((sale: {
        items: Array<{ canteenItemId?: number | string; [key: string]: unknown }>
      }) => {
        if (Array.isArray(sale.items)) {
          sale.items = sale.items.map((line) => {
            if (typeof line.canteenItemId === 'number') {
              return {
                ...line,
                canteenItemId: idMaps.canteenItems.get(line.canteenItemId) ?? String(line.canteenItemId),
              }
            }
            return line
          })
        }
      })

      // stockPurchases — top-level canteenItemId FK
      await tx.table('stockPurchases').toCollection().modify((purchase: {
        canteenItemId: number | string
      }) => {
        if (typeof purchase.canteenItemId === 'number') {
          purchase.canteenItemId = idMaps.canteenItems.get(purchase.canteenItemId) ?? String(purchase.canteenItemId)
        }
      })

      // bookings — top-level tableId FK + consumedSessionId FK
      // consumedSessionId points into sessions (just rewritten in Phase 2), so
      // any legacy numeric value must be remapped through idMaps.sessions or
      // the post-upgrade Booking row will hold a stale stringified-number that
      // no longer resolves. Type-narrowed Booking declares string for both
      // fields; the callback sees raw upgrade-time data which may be number.
      await tx.table('bookings').toCollection().modify((booking: {
        tableId: number | string
        consumedSessionId?: number | string
      }) => {
        if (typeof booking.tableId === 'number') {
          booking.tableId = idMaps.gameTables.get(booking.tableId) ?? String(booking.tableId)
        }
        if (typeof booking.consumedSessionId === 'number') {
          booking.consumedSessionId = idMaps.sessions.get(booking.consumedSessionId) ?? String(booking.consumedSessionId)
        }
      })
    })
    // Version 21: Phase C Chunk 5 — additive only, no .upgrade() block.
    // Adds optional ClubSettings.pullCursors: per-table initial-pull cursor map
    // used by SyncReader's resumable cursor logic (§7.1). Legacy rows read
    // undefined; SyncReader treats undefined as "{}" and starts from epoch.
    // No new indexes — pullCursors is a JSON blob on the settings singleton row,
    // never queried. Schema string identical to v20 — no index changes.
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
    // Version 22: additive index only, no .upgrade() block. Adds `referenceId`
    // to walletTransactions so the session-reversal (#162 reverseSession) and
    // re-split (#163 resplitSessionPayment) code can query the ledger by
    // referenceId. Those functions ran `.where('referenceId').equals(sessionId)`
    // against a table that only indexed id/customerId/createdAt → Dexie threw
    // "KeyPath referenceId on object store walletTransactions is not indexed"
    // mid-save. Dexie backfills the index for existing rows on open. Only this
    // one keyPath changes; every other store string is identical to v21.
    this.version(22).stores({
      gameTables: 'id, name, gameType, sortOrder, outOfService',
      sessions: 'id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: 'id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, referenceId, [customerId+createdAt]',
      canteenItems: 'id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
      bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
      _outbox: '++seq, table, op, rowId, createdAt',
    })
    // Version 23: #173 Bulk Restock Entry — additive only, no .upgrade() block.
    // Adds the `restockDrafts` table: a DEVICE-LOCAL, NOT-SYNCED singleton draft
    // (R6) holding in-progress bulk-restock quantities so a phone call / back-tap
    // / inline item-create doesn't wipe them. New table starts empty. Also adds
    // optional StockPurchase.kind + .reason (undefined ⇒ 'received') — additive
    // fields, NO index, so the stockPurchases store string is unchanged. kind/
    // reason DO sync (prod columns exist, #174) and MUST be wired into
    // syncPayloadMapper + syncReadMapper before anything writes them (Chunk 5).
    // Every other store string is identical to v22.
    this.version(23).stores({
      gameTables: 'id, name, gameType, sortOrder, outOfService',
      sessions: 'id, tableId, status, startedAt, endedAt',
      settings: 'id',
      sessionItems: 'id, sessionId, addedAt',
      customers: 'id, phone, walkInCode, lastVisitAt',
      walletTransactions: 'id, customerId, createdAt, referenceId, [customerId+createdAt]',
      canteenItems: 'id, name, isActive, sortOrder',
      canteenSales: 'id, createdAt, customerId',
      stockPurchases: 'id, createdAt, canteenItemId, source',
      bookings: 'id, tableId, slotStart, status, [tableId+slotStart]',
      _outbox: '++seq, table, op, rowId, createdAt',
      restockDrafts: 'id',
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
