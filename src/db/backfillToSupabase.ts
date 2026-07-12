// #129 — one-time backfill of pre-Phase-C local rows to Supabase.
//
// THE BUG (#129): Phase C's write path syncs rows on WRITE. Rows that already
// existed in the owner's Dexie before the Chunk-7 cutover (the real game_tables,
// old sessions, wallet history, …) were never uploaded — there is no initial
// upload step. Result: a second device / staff device runs the initial pull and
// gets an EMPTY tables grid because prod game_tables is (nearly) empty. Blocks
// Phase D D9 step 2.
//
// THE FIX (owner decision 12 Jul 2026 — auto-on-boot, all 9 tables): enqueue one
// `insert` outbox row per local row, then let the EXISTING SyncRunner drain them.
// We reuse the shipped push path rather than re-implement §10.4's raw
// `supa.from(table).upsert(rows)` sketch — that predates the payload mapper and
// would send camelCase columns with no club_id (400 / RLS-fail). An `insert`
// outbox row routes through pushOne → toSupabaseRow (camelCase→snake_case +
// club_id stamp) → upsert.
//
// ── ignoreDuplicates=true (the #129-runtime fix) ────────────────────────────
// Every backfill outbox row carries ignoreDuplicates:true, so pushOne upserts
// with ON CONFLICT DO NOTHING. WHY: pushOne's normal path is ON CONFLICT DO
// UPDATE; re-pushing a row ALREADY on the server (e.g. the ~78 customers already
// synced) would run an UPDATE. `wallet_transactions` is an append-only ledger
// whose UPDATE policy was DROPPED in D1 (§4.6) — so an ON-CONFLICT-DO-UPDATE
// there 403s ("violates RLS USING expression"), dead-letters, and blocks the
// queue (observed in the first backfill runtime test). DO NOTHING is correct for
// EVERY table: a pre-existing server row is authoritative (it got there via the
// normal sync path or a prior backfill), and any real edit rides the normal
// syncedUpdate path afterwards. This lets us enqueue ALL local rows blindly —
// no per-table server-id pre-check, so NO boot-time network reads on the
// lock-contended main client (Pattern A7/S16).
//
// WHY NOT syncedCreate: that wrapper `.add()`s the data row, which already
// exists locally → ConstraintError. We only need the OUTBOX half, so we write
// outbox rows directly (raw db._outbox — same "bookkeeping, never a wrapper"
// rationale as syncPullCursors).
//
// ONE-TIME: guarded by settings.backfillEnqueuedAt. Set once the enqueue tx
// commits; the boot runner never re-enqueues on this device.
//
// FK-SAFE ORDER: catalog tables (game_tables, canteen_items, customers) before
// operational tables that reference them (SYNC_TABLES_PULL_ORDER). Outbox drain
// is FIFO by seq, so enqueue order == push order.

import { db } from './database'
import { scheduleDrain } from './scheduleDrain'
import { dexieTableFor, SYNC_TABLES_PULL_ORDER } from './syncTableMap'
import type { OutboxRow, SyncTableName } from '../types'

const SETTINGS_ROW_ID = 1

export interface BackfillResult {
  ran: boolean                                  // false = already done (sentinel set)
  enqueued: number                              // total outbox rows added
  perTable: Partial<Record<SyncTableName, number>>
}

/**
 * Enqueue one `insert` outbox row (ignoreDuplicates) per local row across all 9
 * synced tables, FK-safe order, once per device. No-op if the sentinel is set.
 * Kicks the SyncRunner once at the end. Never throws on an empty DB — enqueues 0
 * and still stamps the sentinel. All reads + writes + the sentinel stamp happen
 * in ONE Dexie tx (no network), so a power-cut can't half-enqueue with the
 * sentinel set.
 */
export async function backfillLocalRowsToSupabase(): Promise<BackfillResult> {
  const settingsRow = await db.settings.get(SETTINGS_ROW_ID)
  if (settingsRow?.backfillEnqueuedAt) {
    return { ran: false, enqueued: 0, perTable: {} }
  }

  const perTable: Partial<Record<SyncTableName, number>> = {}
  let enqueued = 0

  const dexieTables = SYNC_TABLES_PULL_ORDER.map(dexieTableFor)
  const txStores = [...dexieTables.map((t) => db[t]), db._outbox, db.settings]

  await db.transaction('rw', txStores, async () => {
    for (const syncTable of SYNC_TABLES_PULL_ORDER) {
      const dexieTable = dexieTableFor(syncTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: Array<{ id?: string }> = await (db[dexieTable] as any).toArray()
      let count = 0
      for (const row of rows) {
        // Every post-v20 synced row carries a string UUID id (Post-v20 ID law).
        // A row without one can't be upserted by id — skip it loudly.
        if (typeof row.id !== 'string' || row.id.length !== 36) {
          // eslint-disable-next-line no-console
          console.warn(`[backfill] skipping ${syncTable} row with invalid id:`, row.id)
          continue
        }
        await db._outbox.add(buildBackfillInsertRow(syncTable, row.id, row))
        count++
      }
      if (count > 0) perTable[syncTable] = count
      enqueued += count
    }
    // Stamp the sentinel INSIDE the tx — atomic with the enqueue.
    await db.settings.update(SETTINGS_ROW_ID, { backfillEnqueuedAt: Date.now() })
  })

  if (enqueued > 0) scheduleDrain()
  return { ran: true, enqueued, perTable }
}

// Mirrors buildOutboxRow in syncWrappers.ts (kept private there), but always an
// `insert` op WITH ignoreDuplicates:true (ON CONFLICT DO NOTHING — see header).
// pushOne maps the payload to the wire shape + stamps club_id.
function buildBackfillInsertRow(
  table: SyncTableName,
  rowId: string,
  payload: unknown,
): Omit<OutboxRow, 'seq'> {
  return {
    idempotencyKey: crypto.randomUUID(),
    table,
    op: 'insert',
    rowId,
    payload,
    ignoreDuplicates: true,
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
    createdAt: Date.now(),
  }
}
