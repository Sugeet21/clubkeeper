// Phase C Chunk 5.0/5.2 — per-table initial-pull cursor storage.
//
// SyncReader's resumable initial pull (§7.1) needs to remember the last
// (updated_at, id) tuple it has applied for each of the 9 synced tables, so
// an interrupted pull resumes mid-table on the next sign-in rather than
// restarting from epoch. Realtime events (Chunk 5.3) also advance the cursor
// so a polling-fallback reconnect (Chunk 5.4) never re-pulls events realtime
// already delivered.
//
// WHY COMPOUND (ts + id)
// `.gt('updated_at', cursor.ts)` would skip every row sharing the boundary
// timestamp on the next page — silent data loss. Compound cursor with
// `(updated_at > ts) OR (updated_at = ts AND id > cursor.id)` plus `ORDER BY
// (updated_at, id)` guarantees no row is skipped and no row is applied twice.
// bulkPut is idempotent so a same-page overlap would be safe anyway, but the
// compound cursor keeps the boundary tight.
//
// STORAGE: the cursor map lives on `db.settings` row 1 in the optional
// `pullCursors` field added by Dexie v21. One JSON blob, never queried —
// always read whole and written whole.
//
// WRITE PATH: every write here MUST use the raw `db.settings.update(1, ...)`
// path. Going through a sync wrapper (syncedUpdate) would queue an outbox
// row — i.e. the act of recording "we successfully pulled customers" would
// itself need to be pushed back to Supabase, which is nonsense and would
// recurse forever. The cursor map is per-device bookkeeping; it has no
// place on the wire.

import { db } from './database'
import type { SyncTableName } from '../types'

export interface PullCursor {
  ts: string   // last applied updated_at (ISO string)
  id: string   // last applied row id at that ts
}

type CursorMap = Partial<Record<SyncTableName, PullCursor | null>>

const SETTINGS_ROW_ID = 1

/**
 * Returns the current cursor for a single table, or `null` if none recorded
 * yet (in which case SyncReader pulls from epoch).
 */
export async function getPullCursor(
  table: SyncTableName,
): Promise<PullCursor | null> {
  const row = await db.settings.get(SETTINGS_ROW_ID)
  const cursor = row?.pullCursors?.[table]
  return cursor ?? null
}

/**
 * Returns the complete cursor map (or an empty object if none has been
 * written yet). Used at SyncReader.start() to seed the in-memory state.
 */
export async function getAllPullCursors(): Promise<CursorMap> {
  const row = await db.settings.get(SETTINGS_ROW_ID)
  return row?.pullCursors ?? {}
}

/**
 * Persists a new cursor for `table`. Raw `db.settings.update` — NEVER a sync
 * wrapper (see header). Reads the current map, merges in the new value,
 * writes the whole object back so existing entries for other tables are
 * preserved.
 */
export async function setPullCursor(
  table: SyncTableName,
  cursor: PullCursor,
): Promise<void> {
  const row = await db.settings.get(SETTINGS_ROW_ID)
  const next: CursorMap = { ...(row?.pullCursors ?? {}), [table]: cursor }
  await db.settings.update(SETTINGS_ROW_ID, { pullCursors: next })
}

/**
 * Clears every recorded cursor. Used by the DEV TestSyncReader page (Chunk
 * 5.5) to force a fresh initial pull from epoch.
 */
export async function resetPullCursors(): Promise<void> {
  await db.settings.update(SETTINGS_ROW_ID, { pullCursors: {} })
}
