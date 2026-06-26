// Phase C Chunk 4.1 — Dexie camelCase → Supabase snake_case payload mappers.
//
// Why this file exists
// --------------------
// The Dexie row shape is camelCase (e.g. `createdAt`, `walletBalance`,
// `lastVisitAt`) because that's how the TypeScript interfaces in src/types
// declare them. The Supabase tables are snake_case (`created_at`,
// `wallet_balance`, ...). The SyncRunner outbox stores a raw copy of the
// Dexie row, so without this layer every push 400s with
//   "Could not find the 'createdAt' column of '<table>' in the schema cache".
//
// Discovered during owner E2E of Chunk 4 (26 Jun 2026): 9 _test_ customer
// rows dead-lettered with that exact error. See bug_patterns.md Pattern S14
// and GitHub issue #110.
//
// Design choices (Sugeet confirmed via questionnaire, Chunk 4 fix-up)
// -------------------------------------------------------------------
// 1. Conversion at PUSH time (here), not at queue time. Outbox keeps the
//    camelCase Dexie row visible for DEV inspection — matches the data
//    table 1:1, no divergence.
// 2. Strict per-table ALLOWLIST. Each mapper declares exactly which
//    Supabase columns it sends. Dexie-only fields (rateSnapshot,
//    framesPlayed, walkInCode, _migrationSeq, etc.) are silently dropped.
//    Unknown Supabase columns the Dexie row provides? Also dropped.
// 3. NOT all 9 tables are mapped yet. Customer + canteen_sales are
//    fully mapped (they cover the TestOutbox smoke tests). The other 7
//    THROW a clear "not yet mapped" error so Chunk 7 (queries.ts cutover)
//    has to wire each one deliberately — silently dropping data on a
//    half-mapped table is the failure mode this guard prevents.

import type { SyncTableName } from '../types'

// ─── Public API ─────────────────────────────────────────────────────────────

/** The opaque row shape we get from OutboxRow.payload. Each mapper narrows it. */
type DexieRow = Record<string, unknown>

/** The shape SyncRunner.pushOne hands to supabase.from(...).upsert(...). */
export type SupabaseWireRow = Record<string, unknown>

/**
 * Convert a camelCase Dexie row into a snake_case wire payload that
 * Supabase's PostgREST will accept.
 *
 * @param table  Supabase wire-format name (snake_case)
 * @param row    Whatever the wrapper put in OutboxRow.payload
 * @param clubId The owner's club_id from JWT; required on every row by RLS
 * @returns A plain object with ONLY the columns Supabase knows about
 * @throws Error if the table has no mapper wired yet (forces Chunk 7 to
 *         enable each table consciously)
 */
export function toSupabaseRow(
  table: SyncTableName,
  row: unknown,
  clubId: string,
): SupabaseWireRow {
  const mapper = MAPPERS[table]
  if (!mapper) {
    throw new Error(
      `syncPayloadMapper: table '${table}' has no payload mapper yet — wire it before pushing rows of this kind`,
    )
  }
  if (typeof row !== 'object' || row === null) {
    throw new Error(`syncPayloadMapper: payload for '${table}' is not an object`)
  }
  return mapper(row as DexieRow, clubId)
}

// ─── Internals ──────────────────────────────────────────────────────────────

type Mapper = (row: DexieRow, clubId: string) => SupabaseWireRow

const MAPPERS: Partial<Record<SyncTableName, Mapper>> = {
  // ── customers ────────────────────────────────────────────────────────
  // Supabase columns: id, club_id, name, phone, wallet_balance,
  //   coins_balance, notes, created_at, updated_at, deleted_at,
  //   created_by, updated_by
  // Dexie fields dropped: walkInCode (Dexie-only UX hint),
  //   lastVisitAt, firstTopupAt, lastStreakBonusAt, expiryAppliedAt
  //   (engagement timestamps — Dexie-local; not in Supabase DDL).
  customers: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.name !== undefined) out.name = row.name
    if (row.phone !== undefined) out.phone = row.phone
    if (row.walletBalance !== undefined) out.wallet_balance = row.walletBalance
    if (row.coinBalance !== undefined) out.coins_balance = row.coinBalance
    if (row.notes !== undefined) out.notes = row.notes
    if (row.createdAt !== undefined) out.created_at = msToIso(row.createdAt as number | string)
    if (row.updated_at !== undefined) out.updated_at = row.updated_at
    if (row.deleted_at !== undefined) out.deleted_at = row.deleted_at
    return out
  },

  // ── canteen_sales ─────────────────────────────────────────────────────
  // Supabase columns: id, club_id, canteen_item_id, name_snapshot,
  //   price_snapshot, quantity, total, payment_method, customer_id,
  //   created_at, updated_at, deleted_at, created_by, updated_by
  // Notable: Dexie CanteenSale carries `items: [...]` (multi-line cart)
  //   but Supabase canteen_sales is one-row-per-line. For v1 we collapse
  //   the cart into a single row using the first line's snapshot and the
  //   cart's total. Cleaner multi-row mapping arrives with Chunk 7's
  //   createCanteenSale cutover (where we'd emit syncedCreateBatch one
  //   row per cart line).
  canteen_sales: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    const items = Array.isArray(row.items) ? (row.items as DexieRow[]) : []
    const firstLine = items.length > 0 ? items[0] : null
    // Multi-line cart collapse warning — Chunk 4.1 limitation. Chunk 7 will
    // emit one syncedCreate per cart line via syncedCreateBatch instead.
    if (import.meta.env.DEV && items.length > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `[syncPayloadMapper] canteen_sales: collapsing ${items.length} cart lines into one Supabase row — Chunk 7 limitation`,
      )
    }
    if (firstLine) {
      if (firstLine.canteenItemId !== undefined) {
        out.canteen_item_id = firstLine.canteenItemId
      }
      out.name_snapshot = (firstLine.name as string) ?? ''
      out.price_snapshot = (firstLine.price as number) ?? 0
      out.quantity = (firstLine.quantity as number) ?? 1
    } else {
      out.name_snapshot = ''
      out.price_snapshot = 0
      out.quantity = 1
    }
    if (row.total !== undefined) out.total = row.total
    if (row.paymentBreakdown !== undefined) {
      out.payment_method = inferPaymentMethod(
        row.paymentBreakdown as { cash?: number; upi?: number; wallet?: number },
      )
    }
    if (row.customerId !== undefined) out.customer_id = row.customerId
    if (row.createdAt !== undefined) out.created_at = msToIso(row.createdAt as number | string)
    if (row.updated_at !== undefined) out.updated_at = row.updated_at
    if (row.deleted_at !== undefined) out.deleted_at = row.deleted_at
    return out
  },

  // ── Not-yet-mapped tables ─────────────────────────────────────────────
  // These throw on push. Chunk 7 wires them one at a time as queries.ts
  // mutation sites cut over to the wrappers. Throwing here is intentional
  // — silent fallthrough would let real data hit Supabase as a half-mapped
  // row and we'd diagnose it the way #109 was diagnosed: very slowly.
  //
  // game_tables, sessions, session_items, canteen_items,
  // wallet_transactions, stock_purchases, bookings
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stamp(clubId: string): SupabaseWireRow {
  return { club_id: clubId }
}

/** Dexie stores epoch ms; Supabase timestamptz wants ISO strings. */
function msToIso(ms: number | string): string {
  if (typeof ms === 'string') return ms // already ISO (defensive)
  return new Date(ms).toISOString()
}

/** PaymentBreakdown → Supabase payment_method enum (best-effort guess).
 *  When mixed, pick the largest portion; ties prefer cash. */
function inferPaymentMethod(b: {
  cash?: number
  upi?: number
  wallet?: number
}): 'cash' | 'upi' | 'wallet' {
  const cash = b.cash ?? 0
  const upi = b.upi ?? 0
  const wallet = b.wallet ?? 0
  if (cash >= upi && cash >= wallet) return 'cash'
  if (upi >= wallet) return 'upi'
  return 'wallet'
}
