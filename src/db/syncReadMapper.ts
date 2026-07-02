// Phase C Chunk 5.2 — Supabase snake_case → Dexie camelCase read mappers.
//
// Symmetric with src/db/syncPayloadMapper.ts (write side). The write side
// exists to prevent Pattern S14 (silent snake_case/camelCase drop) on push;
// this file prevents the equivalent class on pull. In particular it prevents
// the LWW-corrupting bug where a Supabase timestamptz column (ISO string)
// silently lands in a Dexie epoch-ms number field, which would then be
// compared to a number in the LWW handler and always compare as "wrong".
// Timestamp conversion is EXPLICIT per column; no naming-based guess.
//
// FAIL-LOUD CONTRACT (matches syncPayloadMapper)
// Only tables whose BIDIRECTIONAL shape has been designed get a mapper.
// Today that's customers + canteen_sales — same two the write side covers.
// The other 7 THROW. Adding a table here requires designing the round-trip
// shape (which fields survive, which stay Dexie-local) — Chunk 5.2b will do
// that as a batch for the remaining 7. Silently decoding "whatever the DDL
// happens to declare" would strand Dexie-local fields (e.g. Session.tableMoves)
// on a fresh device pull — the exact live-data-loss bug this contract prevents.
//
// FRESH-DEVICE VS EXISTING-DEVICE PULL
// Initial pull always uses bulkPut, which replaces by primary key. Fresh
// device = empty Dexie → bulkPut creates. Existing device with local rows =
// bulkPut replaces, but SyncReader filters out rows with a pending outbox
// entry BEFORE bulkPut (the outbox-guard). Rows the user has not touched
// locally get the server version, which is the correct meaning of "sync".
// Seed rows (game_tables inserted by seedIfEmpty on first launch) survive as
// long as the server is empty for that table on this club — a fresh device
// with empty server = pull is a no-op for that table = seed persists. A
// fresh device pulling against a server that already has game_tables from
// another device = server wins on those ids, which is exactly what "sync"
// means. game_tables isn't wired in 5.2 anyway.

import type { SyncTableName } from '../types'
import type { Customer } from '../types/customer'
import type { CanteenSale, PaymentBreakdown } from '../types'

// ─── Public API ─────────────────────────────────────────────────────────────

/** The opaque row shape we get from a Supabase `.select('*')`. */
type SupabaseRow = Record<string, unknown>

/** The Dexie-shaped row the caller (SyncReader) will bulkPut. */
export type DexieReadRow = Record<string, unknown>

/**
 * Convert a snake_case Supabase row into a camelCase Dexie row.
 *
 * @param table  Supabase wire-format name (snake_case)
 * @param row    Raw row body from `.select('*')`
 * @returns A Dexie-shaped row ready for bulkPut. ALL timestamp fields land as
 *          camelCase EPOCH MS (`createdAt`, `updatedAt`, `deletedAt`, ...).
 *          Raw snake_case ISO fields are NEVER persisted on the Dexie side —
 *          locally-stamped `toISOString()` ("...Z") and PostgREST timestamps
 *          ("...+00:00") are not string-comparable, so the Chunk 5.3 LWW
 *          handler compares NUMBERS only (#117, owner decision 2 Jul 2026).
 * @throws Error if the table has no read mapper yet (fail-loud contract,
 *         same as the write side).
 */
export function fromSupabaseRow(
  table: SyncTableName,
  row: unknown,
): DexieReadRow {
  const mapper = READ_MAPPERS[table]
  if (!mapper) {
    throw new Error(
      `syncReadMapper: table '${table}' has no read mapper yet — its bidirectional shape must be designed (Chunk 5.2b) before pulls of this kind are safe`,
    )
  }
  if (typeof row !== 'object' || row === null) {
    throw new Error(`syncReadMapper: row for '${table}' is not an object`)
  }
  return mapper(row as SupabaseRow)
}

// ─── Internals ──────────────────────────────────────────────────────────────

type Mapper = (row: SupabaseRow) => DexieReadRow

const READ_MAPPERS: Partial<Record<SyncTableName, Mapper>> = {
  // ── customers ────────────────────────────────────────────────────────
  // Supabase columns (from 20260625_phase_c_sync_tables.sql §4.4):
  //   id, club_id, name, phone, wallet_balance, coins_balance, notes,
  //   created_at, updated_at, deleted_at, created_by, updated_by
  //
  // Dexie-local fields not on the server (left undefined on fresh pull):
  //   walkInCode, lastVisitAt, firstTopupAt, lastStreakBonusAt, expiryAppliedAt
  //   → correct: fresh device has no engagement history yet.
  //
  // Server-only fields intentionally dropped (Dexie has no home):
  //   club_id (redundant — this device has exactly one owner club),
  //   notes (Dexie Customer has no notes field today — silently dropping is
  //          acceptable; Chunk 5.2b will decide whether to widen Customer),
  //   created_by / updated_by (owner tracking; not surfaced in Dexie today).
  customers: (row): Partial<Customer> => ({
    id: reqStr(row.id, 'customers.id'),
    name: nullableStr(row.name),
    phone: nullableStr(row.phone),
    walletBalance: reqNum(row.wallet_balance, 'customers.wallet_balance'),
    coinBalance: optNum(row.coins_balance),
    createdAt: isoToMs(row.created_at, 'customers.created_at'),
    // #117: LWW metadata lands as camelCase EPOCH MS. The 5.3 LWW handler
    // compares numbers (server ISO parsed at compare time) — never strings.
    // Raw snake_case fields must not persist on the Dexie side.
    updatedAt: isoToMs(row.updated_at, 'customers.updated_at'),
    ...(row.deleted_at !== undefined && row.deleted_at !== null
      ? { deletedAt: isoToMs(row.deleted_at, 'customers.deleted_at') }
      : {}),
  }),

  // ── canteen_sales ─────────────────────────────────────────────────────
  // Supabase columns (from §4.7):
  //   id, club_id, canteen_item_id, name_snapshot, price_snapshot, quantity,
  //   total, payment_method, customer_id, created_at, updated_at, deleted_at,
  //   created_by, updated_by
  //
  // The write mapper collapses a multi-line Dexie cart into ONE Supabase row
  // (syncPayloadMapper.ts:105-141 — Chunk 4.1 limitation). We reconstruct a
  // single-item items[] array on read. paymentBreakdown is inferred from
  // payment_method (write side does the inverse via inferPaymentMethod).
  //
  // Dexie CanteenSale fields with no server home (left undefined on pull):
  //   subtotal (recomputed as total; single-line cart today),
  //   notes.
  canteen_sales: (row): Partial<CanteenSale> => {
    const priceSnapshot = reqNum(row.price_snapshot, 'canteen_sales.price_snapshot')
    const quantity = reqNum(row.quantity, 'canteen_sales.quantity')
    const total = reqNum(row.total, 'canteen_sales.total')
    const nameSnapshot = reqStr(row.name_snapshot, 'canteen_sales.name_snapshot')
    const paymentMethod = reqStr(row.payment_method, 'canteen_sales.payment_method')

    return {
      id: reqStr(row.id, 'canteen_sales.id'),
      createdAt: isoToMs(row.created_at, 'canteen_sales.created_at'),
      items: [
        {
          name: nameSnapshot,
          price: priceSnapshot,
          quantity,
          ...(row.canteen_item_id != null
            ? { canteenItemId: reqStr(row.canteen_item_id, 'canteen_sales.canteen_item_id') }
            : {}),
        },
      ],
      subtotal: total,   // single-line cart today; subtotal == total
      total,
      paymentBreakdown: paymentMethodToBreakdown(paymentMethod, total),
      ...(row.customer_id != null
        ? { customerId: reqStr(row.customer_id, 'canteen_sales.customer_id') }
        : {}),
      // #117: LWW metadata as camelCase epoch ms (see customers mapper).
      updatedAt: isoToMs(row.updated_at, 'canteen_sales.updated_at'),
      ...(row.deleted_at !== undefined && row.deleted_at !== null
        ? { deletedAt: isoToMs(row.deleted_at, 'canteen_sales.deleted_at') }
        : {}),
    }
  },

  // ── Not-yet-mapped tables — throw on pull ─────────────────────────────
  // game_tables, sessions, session_items, canteen_items,
  // wallet_transactions, stock_purchases, bookings
  //
  // Chunk 5.2b will design the bidirectional shape (write + read together)
  // for these seven. Adding a mapper here without a paired write mapper
  // would create a one-way sync: server → Dexie works but Dexie → server
  // still throws in syncPayloadMapper, so the two sides diverge silently.
}

// ─── Type-safe field coercers ───────────────────────────────────────────────
//
// Each helper both narrows the type AND throws a targeted error identifying
// the field that failed. Debugging "why is this row broken" in the LWW handler
// three chunks from now needs a message that says which column, not just
// "TypeError: undefined".

function reqStr(v: unknown, field: string): string {
  if (typeof v !== 'string') {
    throw new Error(`syncReadMapper: expected string at ${field}, got ${typeof v}`)
  }
  return v
}

function nullableStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  throw new Error(`syncReadMapper: expected string or null, got ${typeof v}`)
}

function reqNum(v: unknown, field: string): number {
  // Supabase numeric(10,2) comes over the wire as a JSON number.
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Defensive: some drivers return numeric as string. Coerce.
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  throw new Error(`syncReadMapper: expected number at ${field}, got ${typeof v} (${String(v)})`)
}

function optNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** ISO timestamptz → epoch ms. Explicit per-column, never automatic. */
function isoToMs(v: unknown, field: string): number {
  if (typeof v !== 'string') {
    throw new Error(`syncReadMapper: expected ISO string at ${field}, got ${typeof v}`)
  }
  const ms = Date.parse(v)
  if (!Number.isFinite(ms)) {
    throw new Error(`syncReadMapper: unparseable ISO timestamp at ${field}: "${v}"`)
  }
  return ms
}

/** Write-side inferPaymentMethod is lossy (picks the largest portion), so this
 *  is a best-effort inverse: attribute the full total to the single payment
 *  method the server records. Not exact for legacy mixed-payment sales but
 *  correct on the money total (which is what the ledger cares about). */
function paymentMethodToBreakdown(method: string, total: number): PaymentBreakdown {
  switch (method) {
    case 'cash':   return { cash: total, upi: 0, wallet: 0 }
    case 'upi':    return { cash: 0, upi: total, wallet: 0 }
    case 'wallet': return { cash: 0, upi: 0, wallet: total }
    default:
      throw new Error(`syncReadMapper: unknown payment_method '${method}' on canteen_sales`)
  }
}
