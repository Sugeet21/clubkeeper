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
    // #117: Dexie carries LWW metadata as camelCase epoch ms; convert at the wire.
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
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
    // #117: Dexie carries LWW metadata as camelCase epoch ms; convert at the wire.
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
    return out
  },

  // ── game_tables (Chunk 5.2b) ──────────────────────────────────────────
  // Supabase columns: id, club_id, name, table_type, hourly_rate,
  //   per_min_rate, is_active, display_order, config, created_at,
  //   updated_at, deleted_at, created_by, updated_by
  // Dexie-local billing extras (ratePerFrame, rateCard, toleranceMinutes,
  //   rateCardBilling) ride the `config` jsonb column — the DDL comment
  //   sanctions this ("type-specific config (eg snooker billing rule, rate
  //   card)"). `config` is ALWAYS sent in full so removing a rate card on
  //   this device also removes it on the server (partial upsert would
  //   otherwise keep the stale value).
  // per_min_rate is intentionally unused (no Dexie source field).
  // is_active is the INVERSE of Dexie outOfService.
  game_tables: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.name !== undefined) out.name = row.name
    if (row.gameType !== undefined) out.table_type = row.gameType
    if (row.ratePerHour !== undefined) out.hourly_rate = row.ratePerHour
    if (row.outOfService !== undefined) out.is_active = !(row.outOfService as boolean)
    if (row.sortOrder !== undefined) out.display_order = row.sortOrder
    out.config = {
      ...(row.ratePerFrame !== undefined ? { ratePerFrame: row.ratePerFrame } : {}),
      ...(row.rateCard !== undefined ? { rateCard: row.rateCard } : {}),
      ...(row.toleranceMinutes !== undefined ? { toleranceMinutes: row.toleranceMinutes } : {}),
      ...(row.rateCardBilling !== undefined ? { rateCardBilling: row.rateCardBilling } : {}),
    }
    if (row.createdAt !== undefined) out.created_at = msToIso(row.createdAt as number | string)
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
    return out
  },

  // ── sessions (Chunk 5.2b) ─────────────────────────────────────────────
  // Supabase columns: id, club_id, table_id, customer_id, started_at,
  //   ended_at, paused_at, paused_total_ms, status, table_charge,
  //   canteen_charge, total_charge, payment_method, payment_breakdown,
  //   notes, created_at, updated_at, deleted_at, ...
  // ⚠ REQUIRES migration 20260702_sync_client_fields.sql (adds `config`
  //   jsonb). The 14 Dexie-local load-bearing fields (rate snapshots,
  //   billing mode, player info, alarm fields, tableMoves journey) ride
  //   `config` — without them a fresh-device pull cannot bill or display a
  //   session. `config` is ALWAYS sent in full (see game_tables rationale).
  // status is stored VERBATIM ('running' | 'paused' | 'completed') — the
  //   column is unconstrained text; the DDL comment's 'active' is advisory.
  // customer_id stays NULL — Dexie Session has no customerId by design
  //   (wallet linkage = WalletTransaction.referenceId).
  // canteen_charge / total_charge stay NULL — Dexie derives items totals
  //   from sessionItems; storing a denormalised copy here would drift.
  sessions: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.tableId !== undefined) out.table_id = row.tableId
    if (row.startedAt !== undefined) out.started_at = msToIso(row.startedAt as number | string)
    out.ended_at = row.endedAt != null ? msToIso(row.endedAt as number | string) : null
    out.paused_at = row.pausedAt != null ? msToIso(row.pausedAt as number | string) : null
    if (row.pausedTotalMs !== undefined) out.paused_total_ms = row.pausedTotalMs
    if (row.status !== undefined) out.status = row.status
    if (row.amount !== undefined) out.table_charge = row.amount
    if (row.paymentBreakdown !== undefined) {
      out.payment_breakdown = row.paymentBreakdown
      out.payment_method = inferPaymentMethod(
        row.paymentBreakdown as { cash?: number; upi?: number; wallet?: number },
      )
    }
    out.notes = row.note ?? null
    out.config = {
      ...(row.billingMode !== undefined ? { billingMode: row.billingMode } : {}),
      ...(row.rateSnapshot !== undefined ? { rateSnapshot: row.rateSnapshot } : {}),
      ...(row.playerName !== undefined ? { playerName: row.playerName } : {}),
      ...(row.playerCount !== undefined ? { playerCount: row.playerCount } : {}),
      ...(row.framesPlayed !== undefined ? { framesPlayed: row.framesPlayed } : {}),
      ...(row.roundedDurationMs !== undefined ? { roundedDurationMs: row.roundedDurationMs } : {}),
      ...(row.notifyAtMs !== undefined ? { notifyAtMs: row.notifyAtMs } : {}),
      ...(row.notifyAcknowledgedAt !== undefined
        ? { notifyAcknowledgedAt: row.notifyAcknowledgedAt }
        : {}),
      ...(row.tableMoves !== undefined ? { tableMoves: row.tableMoves } : {}),
      ...(row.rateCardSnapshot !== undefined ? { rateCardSnapshot: row.rateCardSnapshot } : {}),
      ...(row.toleranceMinutesSnapshot !== undefined
        ? { toleranceMinutesSnapshot: row.toleranceMinutesSnapshot }
        : {}),
      ...(row.rateCardBillingSnapshot !== undefined
        ? { rateCardBillingSnapshot: row.rateCardBillingSnapshot }
        : {}),
      ...(row.isBackEntry !== undefined ? { isBackEntry: row.isBackEntry } : {}),
      ...(row.paymentInProgress !== undefined ? { paymentInProgress: row.paymentInProgress } : {}),
    }
    // No created_at push — Dexie Session has no createdAt field; the server
    // default now() stamps it on first insert.
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
    // #162 — reversal audit trail travels with the tombstone.
    if (row.deletedBy !== undefined) out.deleted_by = row.deletedBy ?? null
    if (row.deleteReason !== undefined) out.delete_reason = row.deleteReason ?? null
    return out
  },

  // ── session_items (Chunk 5.2b) ────────────────────────────────────────
  // Supabase columns: id, club_id, session_id, name_snapshot,
  //   price_snapshot, quantity, created_at, updated_at, deleted_at, ...
  // Clean 1:1 fit — no migration dependency. Dexie addedAt maps to
  // created_at (both are the row's creation instant; back-entries anchor
  // addedAt inside the session window and that anchoring survives).
  // Dexie-only field dropped: _migrationSeq.
  session_items: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.sessionId !== undefined) out.session_id = row.sessionId
    if (row.name !== undefined) out.name_snapshot = row.name
    if (row.price !== undefined) out.price_snapshot = row.price
    if (row.quantity !== undefined) out.quantity = row.quantity
    if (row.addedAt !== undefined) out.created_at = msToIso(row.addedAt as number | string)
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    // #124 — deletedAt: null must reach the wire as an EXPLICIT `deleted_at:
    // null`: the restoreSessionItem un-delete rides op 'update', and dropping
    // the key here would leave the server tombstone in place forever.
    // undefined still means "omit the column".
    if (row.deletedAt !== undefined) {
      out.deleted_at = row.deletedAt === null ? null : msToIso(row.deletedAt as number | string)
    }
    return out
  },

  // ── canteen_items (Chunk 5.2b) ────────────────────────────────────────
  // Supabase columns: id, club_id, name, price, peak_price, category,
  //   stock_qty, is_active, display_order, created_at, updated_at,
  //   deleted_at, ... (+ stock_enabled from 20260702_sync_client_fields.sql)
  // ⚠ REQUIRES that migration: stock_qty alone cannot represent Dexie's
  //   `currentStock: null` (stock tracking disabled) — stock_enabled
  //   carries the distinction.
  // peak_price is sent as explicit NULL when Dexie peakPrice is undefined
  //   so clearing a peak price on this device also clears it server-side
  //   (a partial upsert would keep the stale value).
  // category stays NULL — no Dexie source field.
  canteen_items: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.name !== undefined) out.name = row.name
    if (row.defaultPrice !== undefined) out.price = row.defaultPrice
    out.peak_price = row.peakPrice ?? null
    if (row.stockEnabled !== undefined) {
      out.stock_enabled = row.stockEnabled
      out.stock_qty = (row.currentStock as number | null) ?? 0
    }
    if (row.isActive !== undefined) out.is_active = row.isActive
    if (row.sortOrder !== undefined) out.display_order = row.sortOrder
    if (row.createdAt !== undefined) out.created_at = msToIso(row.createdAt as number | string)
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    // #162 — an explicit null must CLEAR the server tombstone (un-delete on
    // session reversal re-creating a removed item), so send null through, not
    // just non-null timestamps. Undefined (field absent) still leaves it alone.
    if (row.deletedAt !== undefined) {
      out.deleted_at = row.deletedAt === null ? null : msToIso(row.deletedAt as number | string)
    }
    return out
  },

  // ── wallet_transactions (Chunk 5.2b) ──────────────────────────────────
  // APPEND-ONLY LEDGER (§4.6) — insert only, never update / soft-delete.
  // Supabase columns: id, club_id, customer_id, kind, amount, balance_after,
  //   reference_type, reference_id, payment_method, notes, created_at,
  //   created_by. NO updated_at / deleted_at by design.
  // kind stores the Dexie `type` VERBATIM ('credit'|'debit'|'adjustment') —
  //   the column is unconstrained text; the DDL comment's richer enum is
  //   advisory. amount keeps the Dexie always-positive convention (direction
  //   lives in `type` + referenceType), diverging from the DDL comment's
  //   signed convention — documented here + in the read mapper.
  // ClubCoins fields (balance_type, coin_delta, rupee_equivalent) come from
  //   migration 20260702_sync_client_fields.sql. They're only sent when set
  //   on the Dexie row, so non-coin rows push fine pre-migration; a coin row
  //   pushed pre-migration 400s → visible dead-letter (fail-loud).
  //   That migration also widens reference_id uuid → text (Dexie referenceId
  //   is a free-form soft ref: "sessionId / itemId / null").
  wallet_transactions: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.customerId !== undefined) out.customer_id = row.customerId
    if (row.type !== undefined) out.kind = row.type
    if (row.amount !== undefined) out.amount = row.amount
    if (row.balanceAfter !== undefined) out.balance_after = row.balanceAfter
    if (row.referenceType !== undefined) out.reference_type = row.referenceType
    if (row.referenceId !== undefined) out.reference_id = row.referenceId
    if (row.paymentMode !== undefined) out.payment_method = row.paymentMode
    if (row.notes !== undefined) out.notes = row.notes
    if (row.createdAt !== undefined) out.created_at = msToIso(row.createdAt as number | string)
    if (row.balanceType !== undefined) out.balance_type = row.balanceType
    if (row.coinDelta !== undefined) out.coin_delta = row.coinDelta
    if (row.rupeeEquivalent !== undefined) out.rupee_equivalent = row.rupeeEquivalent
    return out
  },

  // ── stock_purchases (Chunk 5.2b) ──────────────────────────────────────
  // Supabase columns: id, club_id, canteen_item_id, name_snapshot, quantity,
  //   cost, payment_method, vendor, notes, purchased_at, created_at,
  //   updated_at, deleted_at, ...
  // Dexie `source` ('piggy'|'other') maps to payment_method verbatim.
  // Dexie has ONE timestamp (createdAt) — it feeds both purchased_at
  //   (NOT NULL) and created_at.
  // name_snapshot is pushed as '' — Dexie StockPurchase carries no item
  //   name (the FK canteen_item_id is the link; mappers are pure functions
  //   with no DB access to resolve it). The read side drops it.
  // vendor stays NULL — no Dexie source field.
  stock_purchases: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) out.id = row.id
    if (row.canteenItemId !== undefined) out.canteen_item_id = row.canteenItemId
    out.name_snapshot = ''
    if (row.quantityAdded !== undefined) out.quantity = row.quantityAdded
    if (row.cost !== undefined) out.cost = row.cost
    if (row.source !== undefined) out.payment_method = row.source
    if (row.notes !== undefined) out.notes = row.notes
    if (row.createdAt !== undefined) {
      out.purchased_at = msToIso(row.createdAt as number | string)
      out.created_at = msToIso(row.createdAt as number | string)
    }
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
    // #173 — kind/reason PUSH side (prod columns exist, #174; paired with the
    // read mapper). Now that batch-reverse writes them they DO round-trip.
    if (row.kind !== undefined) out.kind = row.kind
    if (row.reason !== undefined) out.reason = row.reason
    return out
  },

  // ── bookings (Chunk 5.2b) ─────────────────────────────────────────────
  // Supabase columns: id, club_id, table_id, customer_id,
  //   customer_name_snapshot, customer_phone_snapshot, starts_at, ends_at,
  //   status, source, advance_paid, notes, intent_id, created_at,
  //   updated_at, deleted_at, ... (+ config from 20260702_sync_client_fields.sql)
  // ⚠ REQUIRES that migration: gameType, tierPrice, durationMin and
  //   consumedSessionId have no typed column — they ride `config` jsonb.
  // Dexie Booking.id IS the Supabase booking_intents.id (audit trail), so
  //   intent_id = id and source is the constant 'player_hub' — every Dexie
  //   booking originates from a player-hub intent today.
  // playerName null maps to '' (customer_name_snapshot is NOT NULL); the
  //   read side maps '' back to null.
  // status stores the Dexie BookingStatus VERBATIM ('confirmed'|'consumed'|
  //   'no_show'|'cancelled') — unconstrained text; DDL comment's
  //   'completed' is advisory.
  // customer_id stays NULL — Dexie Booking has no customerId.
  bookings: (row, clubId) => {
    const out = stamp(clubId)
    if (row.id !== undefined) {
      out.id = row.id
      out.intent_id = row.id
    }
    out.source = 'player_hub'
    if (row.tableId !== undefined) out.table_id = row.tableId
    if (row.playerName !== undefined) out.customer_name_snapshot = row.playerName ?? ''
    if (row.playerPhone !== undefined) out.customer_phone_snapshot = row.playerPhone
    if (row.slotStart !== undefined) out.starts_at = msToIso(row.slotStart as number | string)
    if (row.slotEnd !== undefined) out.ends_at = msToIso(row.slotEnd as number | string)
    if (row.status !== undefined) out.status = row.status
    if (row.advanceAmount !== undefined) out.advance_paid = row.advanceAmount
    if (row.notes !== undefined) out.notes = row.notes
    out.config = {
      ...(row.gameType !== undefined ? { gameType: row.gameType } : {}),
      ...(row.tierPrice !== undefined ? { tierPrice: row.tierPrice } : {}),
      ...(row.durationMin !== undefined ? { durationMin: row.durationMin } : {}),
      ...(row.consumedSessionId !== undefined ? { consumedSessionId: row.consumedSessionId } : {}),
    }
    if (row.confirmedAt !== undefined) out.created_at = msToIso(row.confirmedAt as number | string)
    if (row.updatedAt !== undefined) out.updated_at = msToIso(row.updatedAt as number | string)
    if (row.deletedAt !== undefined && row.deletedAt !== null) {
      out.deleted_at = msToIso(row.deletedAt as number | string)
    }
    return out
  },

  // All 9 synced tables are mapped as of Chunk 5.2b. If a NEW synced table
  // is ever added, it must get a mapper here AND in syncReadMapper.ts —
  // toSupabaseRow still throws on unknown tables (fail-loud), which is the
  // intended behavior; silent fallthrough would let half-mapped data hit
  // Supabase and we'd diagnose it the way #109 was diagnosed: very slowly.
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
