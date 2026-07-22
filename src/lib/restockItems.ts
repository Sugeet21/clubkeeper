// #173 — the SINGLE source of "which canteen items appear on the restock surface,
// and in what order". Both the Bulk Restock ENTRY screen (src/pages/BulkRestock.tsx)
// and the printable SHEET (src/lib/restockSheetPdf.ts) call listRestockItems(), so a
// printed sheet's row N is always the same item as screen row N. Do NOT re-inline the
// orderBy/filter in either caller — that's the R1 duplication this file exists to kill.
//
// Ordering: sortOrder ascending (the owner's own arrangement). Filter: active +
// stock-tracked only. filter() not .where() because IndexedDB stores booleans as
// booleans, so a boolean equality index is unreliable — same reason getCanteenItems
// uses filter() (queries.ts). The table is tiny; a full scan is free.

import { db } from '../db/database'
import type { CanteenItem } from '../types'

/** Active, stock-tracked canteen items in the owner's sortOrder. The row order for
 *  BOTH the entry screen and the printed sheet — call this, never re-inline it. */
export async function listRestockItems(): Promise<CanteenItem[]> {
  return db.canteenItems
    .orderBy('sortOrder')
    .filter((c) => c.isActive === true && c.stockEnabled === true)
    .toArray()
}

// ── Sheet version code (R6) ────────────────────────────────────────────────────
// A short, derivable stamp printed on the sheet so a LATER feature can detect that a
// printed sheet is stale against the current item list (item added / removed / reordered
// / renamed). Derived purely from the ORDERED item list — no clock, no randomness — so
// the same list always yields the same code and any change flips it.
//
// Format:  "<count>-<hash>"   e.g.  "23-8fa1c"
//   count = number of items on the sheet (fast human sanity-check).
//   hash  = 32-bit FNV-1a over "id|name" of each item, in order, joined by "\n",
//           rendered as base-36. Name is included so a rename (which the entry screen
//           shows but reordering alone wouldn't catch) also flips the code.
//
// This is a STALENESS fingerprint, not a security hash — FNV-1a is fine and dependency-
// free. Documented here so the future "your sheet is out of date" check derives the
// current code the same way and compares.
export function restockSheetVersion(items: CanteenItem[]): string {
  let h = 0x811c9dc5 // FNV-1a 32-bit offset basis
  const input = items.map((it) => `${it.id ?? ''}|${it.name}`).join('\n')
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // FNV prime multiply, kept in 32-bit unsigned range via Math.imul + >>> 0.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${items.length}-${h.toString(36)}`
}
