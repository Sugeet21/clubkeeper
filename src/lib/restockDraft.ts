// #173 R6 — draft persistence for the Bulk Restock Entry screen.
//
// The draft is DEVICE-LOCAL UI state, NOT synced. It holds in-progress
// quantities (keyed by canteenItemId, stored as STRINGS so '' stays blank and is
// never coerced to 0 — R2) so a phone call, a back-tap, or creating a new item
// mid-entry (R5) doesn't wipe 20 rows of work. Singleton row (id=1).
//
// Because it's not a synced table, these are PLAIN Dexie ops — NOT syncedCreate /
// syncedUpdate. Nothing here touches the outbox or Supabase. Cleared on confirm
// or explicit discard.

import { db } from '../db/database'
import type { RestockDraft } from '../types'

const DRAFT_ID = 1

/** Load the current draft's quantities, or {} if none. Never throws — a missing
 *  draft is the normal empty state. */
export async function loadRestockDraft(): Promise<Record<string, string>> {
  const row = await db.restockDrafts.get(DRAFT_ID)
  return row?.quantities ?? {}
}

/** Persist the full quantities map. Overwrites the singleton row. Debounce the
 *  CALLER (per-keystroke writes are fine but a small debounce spares IndexedDB).
 *  Empty-string entries are kept verbatim — the map is the source of truth for
 *  "what has the user touched", and '' vs absent both mean "no qty" downstream. */
export async function saveRestockDraft(quantities: Record<string, string>): Promise<void> {
  const draft: RestockDraft = {
    id: DRAFT_ID,
    quantities,
    updatedAt: Date.now(),
  }
  await db.restockDrafts.put(draft)
}

/** Clear the draft. Called on successful confirm or explicit discard. Idempotent
 *  — deleting a non-existent row is a no-op in Dexie. */
export async function clearRestockDraft(): Promise<void> {
  await db.restockDrafts.delete(DRAFT_ID)
}
