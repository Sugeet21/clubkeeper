import Dexie, { type Table } from 'dexie'
import type { GameTable, Session, ClubSettings, SessionItem } from '../types'
import type { Customer } from '../types/customer'
import type { WalletTransaction } from '../types/walletTransaction'

// ─── Per-user DB class ────────────────────────────────────────────────────────
// Database name is `ClubKeeperDB_<userId>` so two different Google accounts
// on the same browser never share IndexedDB data (LIMIT-001 band-aid).
// The old `ClubKeeperDB` (no suffix) is intentionally left untouched on disk
// so a one-time migration can be written later if needed.

export class ClubKeeperDB extends Dexie {
  gameTables!: Table<GameTable, number>
  sessions!: Table<Session, number>
  settings!: Table<ClubSettings, number>
  sessionItems!: Table<SessionItem, number>
  customers!: Table<Customer, string>
  walletTransactions!: Table<WalletTransaction, string>

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
