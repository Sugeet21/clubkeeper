// Phase C Chunk 3 — sync write wrappers.
//
// Every mutation on one of the 9 synced tables MUST go through one of these
// wrappers (Chunk 7 cuts all queries.ts mutation sites over). Direct
// `db.gameTables.add(...)` / `.put(...)` / `.update(...)` / `.delete(...)` on
// any synced table is forbidden post-cutover.
//
// What each wrapper does:
//   1. Opens a single Dexie 'rw' tx over (data table + _outbox).
//   2. Writes the data row mutation (add / put / update with deletedAt — epoch ms, #117).
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
// For atomic multi-table operations use a batch variant, which bundles all data
// writes + all outbox writes in ONE outer tx:
//   • syncedCreateBatch — when every write is a plain create.
//   • syncedBatch (#122) — mixed INSERT+UPDATE, or writes whose decisions depend
//     on reads that must be atomic with them (stock check → decrement). The
//     callback does its own reads on db.* inside the tx and emits ops via the
//     BatchContext. This is what createCanteenSale / recordStockPurchase /
//     updateSessionItem / createBackEntry use.
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

// Per-table row shape constraints. Each row must carry a string `id` (UUID).
// LWW metadata lives on the Dexie row as camelCase EPOCH MS (#117) — the
// wrappers stamp `updatedAt` on update; the wire boundary (syncPayloadMapper
// on push, syncReadMapper on pull) converts to/from ISO. Raw snake_case ISO
// fields must NEVER persist on the Dexie side: locally-stamped
// `toISOString()` ("...Z") and PostgREST timestamps ("...+00:00") are not
// string-comparable, which would silently poison the Chunk 5.3 LWW compare.
export interface SyncedRow {
  id: string
  updatedAt?: number   // epoch ms; optional on create (wrapper stamps it on update)
  deletedAt?: number | null  // epoch ms; set by syncedSoftDelete
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
 * The wrapper reads the current row, merges the patch, stamps `updatedAt`
 * (epoch ms, #117), and writes the merged shape — both to the data table and
 * into the outbox payload. Supabase upsert(onConflict='id') overwrites with
 * the merged shape so the remote ends up equal to the local merged state.
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
    const next = { ...existing, ...patch, updatedAt: Date.now() }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[dexieTable] as any).put(next)
    await db._outbox.add(buildOutboxRow(syncTable, 'update', id, next))
  })
  scheduleDrain()
}

/**
 * Soft-delete a row and queue the soft-delete push.
 *
 * Sets `deletedAt` (epoch ms, #117) to now on the local row. The outbox
 * payload only contains the timestamp; SyncRunner.pushOne converts it to ISO
 * and dispatches a targeted `UPDATE ... SET deleted_at = ... WHERE id = ...`
 * against Supabase rather than a full upsert.
 */
export async function syncedSoftDelete(
  syncTable: SyncTableName,
  id: string,
): Promise<void> {
  const dexieTable = dexieTableFor(syncTable)
  const deletedAt = Date.now()
  await db.transaction('rw', [db[dexieTable], db._outbox], async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db[dexieTable] as any).get(id)
    if (!existing) {
      throw new Error(`syncedSoftDelete: row not found in ${syncTable} for id=${id}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db[dexieTable] as any).update(id, { deletedAt, updatedAt: deletedAt })
    await db._outbox.add(buildOutboxRow(syncTable, 'soft_delete', id, { deletedAt }))
  })
  scheduleDrain()
}

// ─── Create-only batch variant ───────────────────────────────────────────────

export interface SyncedBatchItem {
  table: SyncTableName
  row: SyncedRow
}

/**
 * Multi-table atomic create.
 *
 * Use when a single logical operation must write to TWO OR MORE synced tables
 * atomically AND every write is a plain create. Splitting into multiple
 * syncedCreate calls would break atomicity — a power-cut between them leaves
 * orphan data.
 *
 * All N data writes + N outbox writes happen in one tx. On any throw, all
 * roll back.
 *
 * For mixed INSERT+UPDATE ops (the common case — see #122) or ops whose writes
 * depend on reads that must be atomic with them (stock check → decrement), use
 * `syncedBatch` instead.
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

// ─── Mixed-op atomic batch (#122) ─────────────────────────────────────────────

/**
 * The context handed to a `syncedBatch` callback. Its three methods each write
 * the data row AND the matching outbox row TOGETHER, INSIDE the batch's single
 * tx — so a power-cut can never leave a data row without its outbox companion
 * (or vice versa). This is the whole point of the wrapper (#122): a mixed
 * INSERT+UPDATE operation that must be atomic and syncable, without splitting
 * (breaks the power-cut guarantee) or nesting (Pattern D7).
 *
 * Discipline (same tx-zone rule as the single wrappers): inside the callback,
 * do ONLY Dexie reads/writes and pure synchronous compute. NEVER await
 * supabase / network / a timer — that yields the tx zone and closes the tx.
 * `crypto.randomUUID()` and `Date.now()` are synchronous and safe.
 */
export interface BatchContext {
  /** Insert a new row + queue its `insert` push. Row must carry a UUID `id`. */
  insert(table: SyncTableName, row: SyncedRow): Promise<void>
  /**
   * Read → merge patch → stamp `updatedAt` (epoch ms, #117) → put the FULL
   * merged row + queue an `update` push carrying that merged row. Throws if the
   * row is missing (same fail-loud contract as `syncedUpdate`).
   */
  update(table: SyncTableName, id: string, patch: Record<string, unknown>): Promise<void>
  /**
   * Stamp `deletedAt` + `updatedAt` (epoch ms) → put → queue a `soft_delete`
   * push. Throws on `wallet_transactions` (append-only ledger — write a
   * reversal row, never delete; §4.6). Throws if the row is missing.
   */
  softDelete(table: SyncTableName, id: string): Promise<void>
}

/**
 * Mixed-op atomic batch — the #122 wrapper.
 *
 * Opens ONE Dexie 'rw' tx over the caller-declared `tables` + `_outbox`, then
 * runs `fn(b)` inside it. The caller does its own reads directly on `db.*`
 * (they auto-join the ambient tx) and emits sync ops via `b.insert/update/
 * softDelete`. Every data write and every outbox row commit together or not at
 * all — THAT all-or-nothing is the power-cut guarantee. `scheduleDrain()` is
 * the ONLY post-commit action, called once.
 *
 * `tables` MUST list every synced table the callback READS or WRITES — not just
 * writes. Omitting one makes Dexie throw "<table> is not part of transaction"
 * the first time `fn` touches it: loud, immediate, and caught in testing. Do
 * NOT lock every table to dodge that throw — the tight scope IS the safety net.
 *
 * On any throw inside `fn` (e.g. insufficient stock): the tx aborts → no data
 * row, no outbox row, no drain → the throw propagates to the caller's existing
 * catch. A partial (data committed, outbox lost) is exactly the failure this
 * wrapper exists to prevent.
 *
 * NEVER call this from inside another `db.transaction()` (Pattern D7) — it opens
 * its own. Callers pass DATA (reads + emitted ops), never nested wrapper calls.
 */
export async function syncedBatch(
  tables: SyncTableName[],
  fn: (b: BatchContext) => Promise<void>,
): Promise<void> {
  const dexieTables = Array.from(new Set(tables.map(dexieTableFor)))
  const txStores = [...dexieTables.map((t) => db[t]), db._outbox]

  await db.transaction('rw', txStores, async () => {
    const b: BatchContext = {
      async insert(table, row) {
        const dexieTable = dexieTableFor(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db[dexieTable] as any).add(row)
        await db._outbox.add(buildOutboxRow(table, 'insert', row.id, row))
      },
      async update(table, id, patch) {
        const dexieTable = dexieTableFor(table)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = await (db[dexieTable] as any).get(id)
        if (!existing) {
          throw new Error(`syncedBatch.update: row not found in ${table} for id=${id}`)
        }
        const next = { ...existing, ...patch, updatedAt: Date.now() }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db[dexieTable] as any).put(next)
        await db._outbox.add(buildOutboxRow(table, 'update', id, next))
      },
      async softDelete(table, id) {
        if (table === 'wallet_transactions') {
          throw new Error('syncedBatch.softDelete: wallet_transactions is append-only — write a reversal row, never soft-delete.')
        }
        const dexieTable = dexieTableFor(table)
        const deletedAt = Date.now()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = await (db[dexieTable] as any).get(id)
        if (!existing) {
          throw new Error(`syncedBatch.softDelete: row not found in ${table} for id=${id}`)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db[dexieTable] as any).update(id, { deletedAt, updatedAt: deletedAt })
        await db._outbox.add(buildOutboxRow(table, 'soft_delete', id, { deletedAt }))
      },
    }
    await fn(b)
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
