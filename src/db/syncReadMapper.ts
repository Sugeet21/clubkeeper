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
import type {
  CanteenSale,
  PaymentBreakdown,
  GameTable,
  GameType,
  Session,
  SessionItem,
  CanteenItem,
  StockPurchase,
  RateTier,
  TableMove,
} from '../types'
import type { Booking, BookingStatus } from '../types/booking'
import type {
  WalletTransaction,
  WalletTransactionType,
  WalletPaymentMode,
  WalletReferenceType,
} from '../types/walletTransaction'

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

  // ── game_tables (Chunk 5.2b) ──────────────────────────────────────────
  // Supabase columns (§4.1 of 20260625_phase_c_sync_tables.sql):
  //   id, club_id, name, table_type, hourly_rate, per_min_rate, is_active,
  //   display_order, config, created_at, updated_at, deleted_at, ...
  // `config` jsonb carries the Dexie-local billing extras written by the
  // paired write mapper: ratePerFrame, rateCard, toleranceMinutes,
  // rateCardBilling. PostgREST delivers jsonb as a parsed object — no
  // JSON.parse anywhere (the contract's "never JSON strings" clause).
  // is_active is the INVERSE of Dexie outOfService.
  // Server-only fields dropped: club_id, per_min_rate, created_by/updated_by.
  game_tables: (row): Partial<GameTable> => {
    const config = optJsonObject(row.config)
    return {
      id: reqStr(row.id, 'game_tables.id'),
      name: reqStr(row.name, 'game_tables.name'),
      gameType: reqEnum<GameType>(
        row.table_type,
        ['pool', 'snooker', 'carrom', 'playstation', 'other'],
        'game_tables.table_type',
      ),
      ratePerHour: reqNum(row.hourly_rate, 'game_tables.hourly_rate'),
      outOfService: !reqBool(row.is_active, 'game_tables.is_active'),
      sortOrder: reqNum(row.display_order, 'game_tables.display_order'),
      createdAt: isoToMs(row.created_at, 'game_tables.created_at'),
      ...(config.ratePerFrame !== undefined
        ? { ratePerFrame: reqNum(config.ratePerFrame, 'game_tables.config.ratePerFrame') }
        : {}),
      ...(config.rateCard !== undefined
        ? { rateCard: reqArray<RateTier>(config.rateCard, 'game_tables.config.rateCard') }
        : {}),
      ...(config.toleranceMinutes !== undefined
        ? { toleranceMinutes: reqNum(config.toleranceMinutes, 'game_tables.config.toleranceMinutes') }
        : {}),
      ...(config.rateCardBilling !== undefined
        ? {
            rateCardBilling: reqEnum<'minimum' | 'prorated'>(
              config.rateCardBilling,
              ['minimum', 'prorated'],
              'game_tables.config.rateCardBilling',
            ),
          }
        : {}),
      updatedAt: isoToMs(row.updated_at, 'game_tables.updated_at'),
      ...(row.deleted_at !== undefined && row.deleted_at !== null
        ? { deletedAt: isoToMs(row.deleted_at, 'game_tables.deleted_at') }
        : {}),
    }
  },

  // ── sessions (Chunk 5.2b) ─────────────────────────────────────────────
  // ⚠ REQUIRES migration 20260702_sync_client_fields.sql (adds `config`
  // jsonb). A server session row WITHOUT config cannot be billed or
  // displayed (no rateSnapshot / billingMode / playerCount) — the mapper
  // throws rather than fabricating defaults, per the fail-loud contract.
  // Pre-migration this only fires if rows exist; an empty table no-ops.
  // Server-only fields dropped: club_id, customer_id (Dexie Session has no
  // customerId by design), canteen_charge, total_charge, payment_method
  // (derived — paymentBreakdown is authoritative), created_at (Dexie
  // Session has no createdAt), created_by/updated_by.
  sessions: (row): Partial<Session> => {
    const config = optJsonObject(row.config)
    if (Object.keys(config).length === 0) {
      throw new Error(
        'syncReadMapper: sessions row has no config jsonb — apply migration 20260702_sync_client_fields.sql (rate snapshots / billing mode live there)',
      )
    }
    return {
      id: reqStr(row.id, 'sessions.id'),
      tableId: reqStr(row.table_id, 'sessions.table_id'),
      startedAt: isoToMs(row.started_at, 'sessions.started_at'),
      endedAt: nullableIsoToMs(row.ended_at, 'sessions.ended_at'),
      pausedAt: nullableIsoToMs(row.paused_at, 'sessions.paused_at'),
      pausedTotalMs: reqNum(row.paused_total_ms, 'sessions.paused_total_ms'),
      status: reqEnum<Session['status']>(
        row.status,
        ['running', 'paused', 'completed'],
        'sessions.status',
      ),
      amount: reqNum(row.table_charge, 'sessions.table_charge'),
      note: nullableStr(row.notes),
      ...(row.payment_breakdown !== undefined && row.payment_breakdown !== null
        ? { paymentBreakdown: parseBreakdown(row.payment_breakdown, 'sessions.payment_breakdown') }
        : {}),
      // ── config-carried Dexie fields ──
      billingMode: reqEnum<Session['billingMode']>(
        config.billingMode,
        ['per_hour', 'per_frame'],
        'sessions.config.billingMode',
      ),
      rateSnapshot: reqNum(config.rateSnapshot, 'sessions.config.rateSnapshot'),
      playerName: nullableStr(config.playerName ?? null),
      playerCount: reqNum(config.playerCount, 'sessions.config.playerCount'),
      framesPlayed:
        config.framesPlayed !== undefined && config.framesPlayed !== null
          ? reqNum(config.framesPlayed, 'sessions.config.framesPlayed')
          : null,
      ...(config.roundedDurationMs !== undefined
        ? { roundedDurationMs: reqNum(config.roundedDurationMs, 'sessions.config.roundedDurationMs') }
        : {}),
      ...(config.notifyAtMs !== undefined
        ? {
            notifyAtMs:
              config.notifyAtMs === null
                ? null
                : reqNum(config.notifyAtMs, 'sessions.config.notifyAtMs'),
          }
        : {}),
      ...(config.notifyAcknowledgedAt !== undefined
        ? {
            notifyAcknowledgedAt:
              config.notifyAcknowledgedAt === null
                ? null
                : reqNum(config.notifyAcknowledgedAt, 'sessions.config.notifyAcknowledgedAt'),
          }
        : {}),
      ...(config.tableMoves !== undefined
        ? { tableMoves: reqArray<TableMove>(config.tableMoves, 'sessions.config.tableMoves') }
        : {}),
      ...(config.rateCardSnapshot !== undefined
        ? {
            rateCardSnapshot: reqArray<RateTier>(
              config.rateCardSnapshot,
              'sessions.config.rateCardSnapshot',
            ),
          }
        : {}),
      ...(config.toleranceMinutesSnapshot !== undefined
        ? {
            toleranceMinutesSnapshot: reqNum(
              config.toleranceMinutesSnapshot,
              'sessions.config.toleranceMinutesSnapshot',
            ),
          }
        : {}),
      ...(config.rateCardBillingSnapshot !== undefined
        ? {
            rateCardBillingSnapshot: reqEnum<'minimum' | 'prorated'>(
              config.rateCardBillingSnapshot,
              ['minimum', 'prorated'],
              'sessions.config.rateCardBillingSnapshot',
            ),
          }
        : {}),
      ...(config.isBackEntry !== undefined
        ? { isBackEntry: reqBool(config.isBackEntry, 'sessions.config.isBackEntry') }
        : {}),
      ...(config.paymentInProgress !== undefined
        ? { paymentInProgress: reqBool(config.paymentInProgress, 'sessions.config.paymentInProgress') }
        : {}),
      updatedAt: isoToMs(row.updated_at, 'sessions.updated_at'),
      ...(row.deleted_at !== undefined && row.deleted_at !== null
        ? { deletedAt: isoToMs(row.deleted_at, 'sessions.deleted_at') }
        : {}),
    }
  },

  // ── session_items (Chunk 5.2b) ────────────────────────────────────────
  // Clean 1:1 fit — see the paired write mapper for the addedAt↔created_at
  // rationale. Server-only fields dropped: club_id, created_by/updated_by.
  session_items: (row): Partial<SessionItem> => ({
    id: reqStr(row.id, 'session_items.id'),
    sessionId: reqStr(row.session_id, 'session_items.session_id'),
    name: reqStr(row.name_snapshot, 'session_items.name_snapshot'),
    price: reqNum(row.price_snapshot, 'session_items.price_snapshot'),
    quantity: reqNum(row.quantity, 'session_items.quantity'),
    addedAt: isoToMs(row.created_at, 'session_items.created_at'),
    updatedAt: isoToMs(row.updated_at, 'session_items.updated_at'),
    ...(row.deleted_at !== undefined && row.deleted_at !== null
      ? { deletedAt: isoToMs(row.deleted_at, 'session_items.deleted_at') }
      : {}),
  }),

  // ── canteen_items (Chunk 5.2b) ────────────────────────────────────────
  // ⚠ REQUIRES migration 20260702_sync_client_fields.sql (stock_enabled
  // column). A row without it throws — stock_qty alone cannot distinguish
  // "0 in stock" from "stock tracking off" (Dexie currentStock: null).
  // Server-only fields dropped: club_id, category, created_by/updated_by.
  canteen_items: (row): Partial<CanteenItem> => {
    const stockEnabled = reqBool(row.stock_enabled, 'canteen_items.stock_enabled')
    return {
      id: reqStr(row.id, 'canteen_items.id'),
      name: reqStr(row.name, 'canteen_items.name'),
      defaultPrice: reqNum(row.price, 'canteen_items.price'),
      ...(row.peak_price !== undefined && row.peak_price !== null
        ? { peakPrice: reqNum(row.peak_price, 'canteen_items.peak_price') }
        : {}),
      stockEnabled,
      currentStock: stockEnabled ? reqNum(row.stock_qty, 'canteen_items.stock_qty') : null,
      isActive: reqBool(row.is_active, 'canteen_items.is_active'),
      sortOrder: reqNum(row.display_order, 'canteen_items.display_order'),
      createdAt: isoToMs(row.created_at, 'canteen_items.created_at'),
      updatedAt: isoToMs(row.updated_at, 'canteen_items.updated_at'),
      ...(row.deleted_at !== undefined && row.deleted_at !== null
        ? { deletedAt: isoToMs(row.deleted_at, 'canteen_items.deleted_at') }
        : {}),
    }
  },

  // ── wallet_transactions (Chunk 5.2b) ──────────────────────────────────
  // APPEND-ONLY LEDGER — no updated_at / deleted_at columns, so NO
  // updatedAt/deletedAt land on the Dexie row and the SyncReader pulls this
  // table on a created_at cursor (see cursorColumnFor in syncReader.ts).
  // amount keeps the Dexie always-positive convention (see write mapper).
  // ClubCoins fields tolerate a pre-migration server (columns absent from
  // select * → optional Dexie fields stay undefined).
  // Server-only fields dropped: club_id, created_by.
  wallet_transactions: (row): Partial<WalletTransaction> => ({
    id: reqStr(row.id, 'wallet_transactions.id'),
    customerId: reqStr(row.customer_id, 'wallet_transactions.customer_id'),
    type: reqEnum<WalletTransactionType>(
      row.kind,
      ['credit', 'debit', 'adjustment'],
      'wallet_transactions.kind',
    ),
    amount: reqNum(row.amount, 'wallet_transactions.amount'),
    balanceAfter: reqNum(row.balance_after, 'wallet_transactions.balance_after'),
    paymentMode:
      row.payment_method === null || row.payment_method === undefined
        ? null
        : reqEnum<WalletPaymentMode>(
            row.payment_method,
            ['cash', 'upi', 'card'],
            'wallet_transactions.payment_method',
          ),
    referenceType:
      row.reference_type === null || row.reference_type === undefined
        ? null
        : reqEnum<WalletReferenceType>(
            row.reference_type,
            [
              'topup', 'session', 'item', 'manual', 'refund', 'canteen_sale',
              'coin_redemption', 'coin_expiry', 'welcome_bonus', 'streak_bonus',
              'engagement_log', 'booking_advance',
            ],
            'wallet_transactions.reference_type',
          ),
    referenceId: nullableStr(row.reference_id),
    notes: nullableStr(row.notes),
    createdAt: isoToMs(row.created_at, 'wallet_transactions.created_at'),
    ...(row.balance_type !== undefined && row.balance_type !== null
      ? {
          balanceType: reqEnum<'wallet' | 'coins'>(
            row.balance_type,
            ['wallet', 'coins'],
            'wallet_transactions.balance_type',
          ),
        }
      : {}),
    ...(row.coin_delta !== undefined && row.coin_delta !== null
      ? { coinDelta: reqNum(row.coin_delta, 'wallet_transactions.coin_delta') }
      : {}),
    ...(row.rupee_equivalent !== undefined && row.rupee_equivalent !== null
      ? { rupeeEquivalent: reqNum(row.rupee_equivalent, 'wallet_transactions.rupee_equivalent') }
      : {}),
  }),

  // ── stock_purchases (Chunk 5.2b) ──────────────────────────────────────
  // source is validated against the Dexie union ('piggy'|'other') — our
  // write mapper only ever sends those two; anything else is a foreign
  // writer and throws. createdAt reads from created_at (purchased_at is a
  // duplicate stamped by the write side; created_at is the cursor anchor).
  // Server-only fields dropped: club_id, name_snapshot (no Dexie field),
  // vendor, purchased_at, created_by/updated_by.
  stock_purchases: (row): Partial<StockPurchase> => ({
    id: reqStr(row.id, 'stock_purchases.id'),
    canteenItemId: reqStr(row.canteen_item_id, 'stock_purchases.canteen_item_id'),
    quantityAdded: reqNum(row.quantity, 'stock_purchases.quantity'),
    cost: reqNum(row.cost, 'stock_purchases.cost'),
    source: reqEnum<StockPurchase['source']>(
      row.payment_method,
      ['piggy', 'other'],
      'stock_purchases.payment_method',
    ),
    createdAt: isoToMs(row.created_at, 'stock_purchases.created_at'),
    ...(row.notes !== undefined && row.notes !== null ? { notes: reqStr(row.notes, 'stock_purchases.notes') } : {}),
    updatedAt: isoToMs(row.updated_at, 'stock_purchases.updated_at'),
    ...(row.deleted_at !== undefined && row.deleted_at !== null
      ? { deletedAt: isoToMs(row.deleted_at, 'stock_purchases.deleted_at') }
      : {}),
  }),

  // ── bookings (Chunk 5.2b) ─────────────────────────────────────────────
  // ⚠ REQUIRES migration 20260702_sync_client_fields.sql (config jsonb) —
  // gameType / tierPrice / durationMin live there and are load-bearing for
  // the Bookings page. See the paired write mapper for the id==intent_id
  // and playerName↔'' rationale. Server-only fields dropped: club_id,
  // customer_id, source, intent_id (== id), created_by/updated_by.
  bookings: (row): Partial<Booking> => {
    const config = optJsonObject(row.config)
    if (Object.keys(config).length === 0) {
      throw new Error(
        'syncReadMapper: bookings row has no config jsonb — apply migration 20260702_sync_client_fields.sql (gameType/tierPrice/durationMin live there)',
      )
    }
    const nameSnapshot = reqStr(row.customer_name_snapshot, 'bookings.customer_name_snapshot')
    return {
      id: reqStr(row.id, 'bookings.id'),
      tableId: reqStr(row.table_id, 'bookings.table_id'),
      playerName: nameSnapshot === '' ? null : nameSnapshot,
      playerPhone: reqStr(row.customer_phone_snapshot, 'bookings.customer_phone_snapshot'),
      slotStart: isoToMs(row.starts_at, 'bookings.starts_at'),
      slotEnd: isoToMs(row.ends_at, 'bookings.ends_at'),
      durationMin: reqNum(config.durationMin, 'bookings.config.durationMin'),
      gameType: reqEnum<GameType>(
        config.gameType,
        ['pool', 'snooker', 'carrom', 'playstation', 'other'],
        'bookings.config.gameType',
      ),
      tierPrice: reqNum(config.tierPrice, 'bookings.config.tierPrice'),
      advanceAmount: reqNum(row.advance_paid, 'bookings.advance_paid'),
      status: reqEnum<BookingStatus>(
        row.status,
        ['confirmed', 'consumed', 'no_show', 'cancelled'],
        'bookings.status',
      ),
      ...(config.consumedSessionId !== undefined && config.consumedSessionId !== null
        ? { consumedSessionId: reqStr(config.consumedSessionId, 'bookings.config.consumedSessionId') }
        : {}),
      confirmedAt: isoToMs(row.created_at, 'bookings.created_at'),
      ...(row.notes !== undefined && row.notes !== null
        ? { notes: reqStr(row.notes, 'bookings.notes') }
        : {}),
      updatedAt: isoToMs(row.updated_at, 'bookings.updated_at'),
      ...(row.deleted_at !== undefined && row.deleted_at !== null
        ? { deletedAt: isoToMs(row.deleted_at, 'bookings.deleted_at') }
        : {}),
    }
  },

  // All 9 synced tables are mapped as of Chunk 5.2b. A NEW synced table
  // must get a mapper here AND in syncPayloadMapper.ts — fromSupabaseRow
  // still throws on unknown tables (fail-loud). Adding a read mapper
  // without its paired write mapper would create a one-way sync: server →
  // Dexie works but Dexie → server still throws, so the two sides diverge
  // silently.
}

// ─── Type-safe field coercers ───────────────────────────────────────────────
//
// Each helper both narrows the type AND throws a targeted error identifying
// the field that failed. Debugging "why is this row broken" in the LWW handler
// three chunks from now needs a message that says which column, not just
// "TypeError: undefined".

function reqBool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') {
    throw new Error(`syncReadMapper: expected boolean at ${field}, got ${typeof v}`)
  }
  return v
}

/** Validates a string against a closed union. Fail-loud on anything else —
 *  a value outside the union means the server row was written by something
 *  other than this app's mappers, which needs to be SEEN. */
function reqEnum<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new Error(
    `syncReadMapper: expected one of [${allowed.join(', ')}] at ${field}, got ${String(v)}`,
  )
}

/** jsonb column → object. PostgREST parses jsonb before we see it, so a
 *  string here means something upstream double-encoded — fail loud. Missing
 *  or null returns {} so callers can probe fields uniformly. */
function optJsonObject(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {}
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  throw new Error(`syncReadMapper: expected jsonb object, got ${typeof v}`)
}

/** jsonb array → typed array. Same fail-loud rule as optJsonObject. */
function reqArray<T>(v: unknown, field: string): T[] {
  if (Array.isArray(v)) return v as T[]
  throw new Error(`syncReadMapper: expected array at ${field}, got ${typeof v}`)
}

/** Nullable timestamptz → epoch ms | null (for ended_at / paused_at). */
function nullableIsoToMs(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null
  return isoToMs(v, field)
}

/** payment_breakdown jsonb → PaymentBreakdown. All three keys required —
 *  a partial breakdown means a foreign writer; fail loud. */
function parseBreakdown(v: unknown, field: string): PaymentBreakdown {
  const obj = optJsonObject(v)
  return {
    cash: reqNum(obj.cash, `${field}.cash`),
    upi: reqNum(obj.upi, `${field}.upi`),
    wallet: reqNum(obj.wallet, `${field}.wallet`),
  }
}

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
