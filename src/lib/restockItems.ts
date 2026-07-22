// #173 — the SINGLE source of "which canteen items appear on the restock surface,
// and in what order". Both the Bulk Restock ENTRY screen (src/pages/BulkRestock.tsx)
// and the printable SHEET (src/lib/restockSheetPdf.ts) call listRestockItems(), so a
// printed sheet's row N is always the same item as screen row N. Do NOT re-inline the
// orderBy/filter in either caller — that's the R1 duplication this file exists to kill.
//
// #176 — ORDERING is now (categoryRank, name), NOT sortOrder. Rationale: the owner prints
// the sheet for staff whose paper register is alphabetical; grouping by category (drinks →
// cigarettes → snacks → other, uncategorised last) with A-Z within each group makes the
// printed sheet match how he shops AND how staff reads. This changes BOTH the entry screen
// and the PDF together (single source), so row N still matches on both. Scope is the restock
// surface ONLY — getCanteenItems() (Canteen page / QuickSale / AddItem) stays on sortOrder.
//
// Filter: active + stock-tracked only. filter() not .where() because IndexedDB stores booleans
// as booleans, so a boolean equality index is unreliable — same reason getCanteenItems uses
// filter() (queries.ts). Sort is done in memory (tiny table) since it's a compound key Dexie
// can't index directly; sortOrder is the final tie-break so order is fully deterministic.

import { db } from '../db/database'
import { categoryRank } from '../types'
import type { CanteenItem } from '../types'

/** Active, stock-tracked canteen items ordered (categoryRank, name-A-Z, sortOrder). The row
 *  order for BOTH the entry screen and the printed sheet — call this, never re-inline it. */
export async function listRestockItems(): Promise<CanteenItem[]> {
  const items = await db.canteenItems
    .filter((c) => c.isActive === true && c.stockEnabled === true)
    .toArray()
  return items.sort(compareRestockItems)
}

/** Restock ordering comparator: category group first (drinks→cigarettes→snacks→other→
 *  uncategorised), then item name case-insensitive A-Z, then sortOrder as a stable
 *  final tie-break (two items with the same category + name keep a deterministic order). */
export function compareRestockItems(a: CanteenItem, b: CanteenItem): number {
  const ra = categoryRank(a.category)
  const rb = categoryRank(b.category)
  if (ra !== rb) return ra - rb
  const na = a.name.trim().toLowerCase()
  const nb = b.name.trim().toLowerCase()
  const byName = na.localeCompare(nb)
  if (byName !== 0) return byName
  return a.sortOrder - b.sortOrder
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
