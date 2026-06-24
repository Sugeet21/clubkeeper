// Phase C Chunk 3 — sync write wrappers.
//
// Every mutation on one of the 9 synced tables MUST go through one of these
// wrappers (Chunk 7 cuts all queries.ts mutation sites over). Direct
// `db.gameTables.add(...)` / `.put(...)` / `.update(...)` / `.delete(...)` on
// any synced table is forbidden post-cutover.
//
// What each wrapper does:
//   1. Opens a single Dexie 'rw' tx over (data table + _outbox).
//   2. Writes the data row mutation (add / put / update with deleted_at).
//   3. Writes one _outbox row recording the operation for the SyncRunner
//      (Chunk 4) to push to Supabase later.
//   4. On commit, calls scheduleDrain() to kick the runner (no-op stub in
//      Chunk 3; real runner in Chunk 4).
//
// The atomic-tx guarantee is the load-bearing contract: a power-cut between
// step 2 and step 3 cannot leave a data row without its outbox companion, or
// vice versa. Dexie rolls the whole tx back on any throw.
//
// ─── Pattern D7 ALERT ───────────────────────────────────────────────────────
// These wrappers open their OWN db.transaction(). NEVER call them from inside
// another db.transaction() — Dexie will throw "Transaction is already closed"
// because nested 'rw' transactions over the same stores are not supported.
//
// For atomic multi-table operations (e.g. createCanteenSale, which writes
// canteen_sales + stock_purchases as one atomic op), use the syncedCreateBatch
// variant — it bundles N data writes + N outbox writes in ONE outer tx.
// ─────────────────────────────────────────────────────────────────────────────
//
// Note: scheduleDrain() is called AFTER tx commit (Promise resolves). If the
// caller's surrounding code throws between the wrapper resolving and the next
// await, the outbox row is already in Dexie — it just won't drain until the
// next online event or the 30s interval kick (both Chunk 4). No data lost.

import { db } from './database'
import { scheduleDrain } from './scheduleDrain'
import { dexieTableFor } from './syncTableMap'
import type { SyncTableName, OutboxRow } from '../types'

// Per-table row shape constraints. Each row must carry a string `id` (UUID)
// and a string `updated_at` (ISO). The wrappers stamp `updated_at` on update;
// callers supply it on create.
export interface SyncedRow {
  id: string
  updated_at?: string  // optional on create (wrapper stamps it); required on read
  deleted_at?: string | null
}

// ─── Core wrappers ───────────────────────────────────────────────────────────

/**
 * Insert a new row and queue its sync push.
 *
 * Atomic: row + outbox entry land together, or neither.
 *
 * @param syncTable Supabase wire-format name (snake_case). Caller passes the
 *                  SyncTableName literal; the wrapper looks up the Dexie key.
 * @param row Must have `.id` set to a UUID. Caller-supplied per Pattern D12.
 */
export async function syncedCreate<T extends SyncedRow>(
  syncTable: SyncTableName,
  row: T,
): Promise<void> {
  const dexieTable = dexieTableFor(syncTable)
  await db.transaction('rw', [db[dexieTable], db._outbox], async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[dexieTable] as any).add(row)
    await db._outbox.add(buildOutboxRow(syncTable, 'insert', row.id, row))
  })
  scheduleDrain()
}

/**
 * Patch an existing row and queue its sync push.
 *
 * The wrapper reads the current row, merges the patch, stamps `updated_at`,
 * and writes the merged shape — both to the data table and into the outbox
 * payload. Supabase upsert(onConflict='id') overwrites with the merged shape
 * so the remote ends up equal to the local merged state.
 */
export async function syncedUpdate<T extends SyncedRow>(
  syncTable: SyncTableName,
  id: string,
  patch: Partial<T>,
): Promise<void> {
  const dexieTable = dexieTableFor(syncTable)
  await db.transaction('rw', [db[dexieTable], db._outbox], async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db[dexieTable] as any).get(id)
    if (!existing) {
      throw new Error(`syncedUpdate: row not found in ${syncTable} for id=${id}`)
    }
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[dexieTable] as any).put(next)
    await db._outbox.add(buildOutboxRow(syncTable, 'update', id, next))
  })
  scheduleDrain()
}

/**
 * Soft-delete a row and queue the soft-delete push.
 *
 * Sets `deleted_at` to now on the local row. The outbox payload only contains
 * the timestamp; SyncRunner.pushOne dispatches a targeted `UPDATE ... SET
 * deleted_at = ... WHERE id = ...` against Supabase rather than a full upsert.
 */
export async function syncedSoftDelete(
  syncTable: SyncTableName,
  id: string,
): Promise<void> {
  const dexieTable = dexieTableFor(syncTable)
  const deletedAt = new Date().toISOString()
  await db.transaction('rw', [db[dexieTable], db._outbox], async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db[dexieTable] as any).get(id)
    if (!existing) {
      throw new Error(`syncedSoftDelete: row not found in ${syncTable} for id=${id}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[dexieTable] as any).update(id, { deleted_at: deletedAt, updated_at: deletedAt })
    await db._outbox.add(buildOutboxRow(syncTable, 'soft_delete', id, { deleted_at: deletedAt }))
  })
  scheduleDrain()
}

// ─── Batch variant ───────────────────────────────────────────────────────────

export interface SyncedBatchItem {
  table: SyncTableName
  row: SyncedRow
}

/**
 * Multi-table atomic create.
 *
 * Use when a single logical operation must write to TWO OR MORE synced tables
 * atomically (e.g. createCanteenSale writes canteen_sales + stock_purchases;
 * linkBookingToSession writes bookings + customers). Splitting into multiple
 * syncedCreate calls would break atomicity — a power-cut between them leaves
 * orphan data.
 *
 * All N data writes + N outbox writes happen in one tx. On any throw, all
 * roll back.
 */
export async function syncedCreateBatch(items: SyncedBatchItem[]): Promise<void> {
  if (items.length === 0) return

  // Collect unique Dexie tables for the tx scope. Order doesn't matter for tx
  // semantics — Dexie acquires locks on all named stores up front.
  const dexieTables = Array.from(
    new Set(items.map((i) => dexieTableFor(i.table))),
  )
  const txStores = [...dexieTables.map((t) => db[t]), db._outbox]

  await db.transaction('rw', txStores, async () => {
    for (const item of items) {
      const dexieTable = dexieTableFor(item.table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db[dexieTable] as any).add(item.row)
      await db._outbox.add(buildOutboxRow(item.table, 'insert', item.row.id, item.row))
    }
  })
  scheduleDrain()
}

// ─── Internals ───────────────────────────────────────────────────────────────

function buildOutboxRow(
  table: SyncTableName,
  op: OutboxRow['op'],
  rowId: string,
  payload: unknown,
): Omit<OutboxRow, 'seq'> {
  return {
    idempotencyKey: crypto.randomUUID(),
    table,
    op,
    rowId,
    payload,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt: Date.now(),
  }
}
