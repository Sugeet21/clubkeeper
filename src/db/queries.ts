import { startOfDay, endOfDay } from 'date-fns'
import { db } from './database'
import { calculateAmount, applyRounding } from '../lib/money'
import { validatePlayerName, validateItemName, validateCanteenItemName } from '../lib/validation'
import { seedIfEmpty } from './seed'
import { normalizeName, findMatchingCanteenItem } from '../lib/canteenMatch'
import { syncedCreate, syncedUpdate, syncedSoftDelete, syncedBatch } from './syncWrappers'
import { readAccessTokenLockFree, decodeJwtClaims } from './syncClubId'
import { coinsEarnedForTopup, resolveCoinConfig } from '../lib/coins'
import { toCustomerPhone, phoneLookupCandidates, preferCanonicalPhone } from '../lib/phone'
import { getEngagementConfig } from '../lib/streak'
import type {
  GameTable,
  Session,
  ClubSettings,
  SessionItem,
  CanteenItem,
  CanteenSale,
  StockPurchase,
} from '../types'
import type { Customer } from '../types/customer'
import type { WalletTransaction } from '../types/walletTransaction'
import type { Booking } from '../types/booking'

/**
 * Current Dexie schema version. Mirror of `this.version(N)` in `database.ts`.
 * Used by export/import to gate forward-compatibility. Bump when database.ts bumps.
 */
export const CURRENT_SCHEMA_VERSION = 21

export interface ClubKeeperBackupV21 {
  schemaVersion: 21
  exportedAt: number
  tables: GameTable[]
  sessions: Session[]
  sessionItems: SessionItem[]
  settings: ClubSettings | undefined
  customers: Customer[]
  walletTransactions: WalletTransaction[]
  canteenItems: CanteenItem[]
  canteenSales: CanteenSale[]
  stockPurchases: StockPurchase[]
  bookings: Booking[]
}

// Backwards-compat aliases — structurally identical because v21 is purely
// additive (one optional field on ClubSettings). Prior-version consumers stay
// source-compatible without changes.
export type ClubKeeperBackupV20 = ClubKeeperBackupV21
export type ClubKeeperBackupV19 = ClubKeeperBackupV21
export type ClubKeeperBackupV18 = ClubKeeperBackupV21
export type ClubKeeperBackupV17 = ClubKeeperBackupV21
export type ClubKeeperBackupV16 = ClubKeeperBackupV21

// ─── Tables ──────────────────────────────────────────────────────────────────

export async function getAllTables(): Promise<GameTable[]> {
  return db.gameTables.orderBy('sortOrder').toArray()
}

export async function getTableById(id: string): Promise<GameTable | undefined> {
  return db.gameTables.get(id)
}

export async function addTable(data: Omit<GameTable, 'id'>): Promise<string> {
  // v20: id is caller-supplied (schema no longer uses ++id auto-gen). See #107.
  const id = crypto.randomUUID()
  await syncedCreate('game_tables', { ...data, id })
  return id
}

export async function updateTable(
  id: string,
  data: Partial<Omit<GameTable, 'id'>>,
): Promise<void> {
  await syncedUpdate<GameTable & { id: string }>('game_tables', id, data)
}

/**
 * Phase C (Chunk 7): sync soft-delete — sets the `deletedAt` tombstone instead
 * of removing the row, so the deletion propagates to peer devices. No UI
 * callers today (Tables UI disables via `updateTable({ outOfService })`).
 * Unlike the old hard delete, this throws if the id doesn't exist.
 */
export async function deleteTable(id: string): Promise<void> {
  await syncedSoftDelete('game_tables', id)
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessionForTable(
  tableId: string,
): Promise<Session | undefined> {
  return db.sessions
    .where('tableId')
    .equals(tableId)
    .filter((s) => s.status !== 'completed')
    .first()
}

export async function getAllActiveSessions(): Promise<Session[]> {
  return db.sessions
    .where('status')
    .anyOf(['running', 'paused'])
    .toArray()
}

export async function getSessionById(id: string): Promise<Session | undefined> {
  return db.sessions.get(id)
}

export async function startSession(
  data: Pick<
    Session,
    | 'tableId'
    | 'billingMode'
    | 'rateSnapshot'
    | 'playerName'
    | 'playerCount'
    | 'note'
    | 'framesPlayed'
  >,
  notifyAfterMs?: number | null,
): Promise<string> {
  const startedAt = Date.now()
  const alarmFields =
    typeof notifyAfterMs === 'number' && notifyAfterMs > 0
      ? { notifyAtMs: startedAt + notifyAfterMs, notifyAcknowledgedAt: null }
      : {}

  // Snapshot rate card at session start (Pattern T3)
  const table = await db.gameTables.get(data.tableId)
  const rateCardFields =
    table?.rateCard && table.rateCard.length > 0
      ? {
          rateCardSnapshot: structuredClone(table.rateCard),
          toleranceMinutesSnapshot: table.toleranceMinutes ?? 10,
          rateCardBillingSnapshot: table.rateCardBilling ?? 'prorated',
        }
      : {}

  // v20: id is caller-supplied. See #107.
  const id = crypto.randomUUID()
  await syncedCreate('sessions', {
    ...data,
    id,
    startedAt,
    endedAt: null,
    pausedTotalMs: 0,
    pausedAt: null,
    status: 'running',
    amount: 0,
    ...alarmFields,
    ...rateCardFields,
  } as Session & { id: string })
  return id
}

export async function acknowledgeNotify(sessionId: string): Promise<void> {
  await syncedUpdate<Session & { id: string }>('sessions', sessionId, { notifyAcknowledgedAt: Date.now() })
}

export async function snoozeNotify(sessionId: string, snoozeMs: number): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) return
  const original = session.notifyAtMs ?? Date.now()
  const candidate = original + snoozeMs
  // Anchor to original fire time so "snooze 15 min" means exactly 15 min from fire,
  // not 15 min from when the user tapped (Pattern T6). Fall back to now + snoozeMs
  // if user took so long that the anchored time is already in the past.
  const newNotifyAt = candidate > Date.now() ? candidate : Date.now() + snoozeMs
  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    notifyAtMs: newNotifyAt,
    notifyAcknowledgedAt: null,
  })
}

/**
 * Set or replace alarm on an existing (running or paused) session.
 * notifyAfterMs = duration FROM NOW. Pass null to clear the alarm entirely.
 */
export async function updateSessionNotify(
  sessionId: string,
  notifyAfterMs: number | null,
): Promise<void> {
  if (notifyAfterMs === null) {
    await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
      notifyAtMs: null,
      notifyAcknowledgedAt: null,
    })
    return
  }
  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    notifyAtMs: Date.now() + notifyAfterMs,
    notifyAcknowledgedAt: null,
  })
}

export async function pauseSession(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'running') return

  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    status: 'paused',
    pausedAt: Date.now(),
  })
}

export async function resumeSession(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'paused' || session.pausedAt === null) return

  const delta = Date.now() - session.pausedAt
  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    status: 'running',
    pausedTotalMs: session.pausedTotalMs + delta,
    pausedAt: null,
  })
}

export async function stopSession(sessionId: string): Promise<Session> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status === 'completed') return session

  const now = Date.now()
  let { pausedTotalMs } = session

  // Fold in any in-progress pause before finalising
  if (session.status === 'paused' && session.pausedAt !== null) {
    pausedTotalMs += now - session.pausedAt
  }

  const rawElapsedMs = now - session.startedAt - pausedTotalMs

  // Apply time rounding (linear per-hour sessions only; rate card sessions ignore rounding)
  const settings = await db.settings.get(1)
  let billableMs = rawElapsedMs
  let roundedDurationMs: number | undefined

  const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
  if (!isRateCard && session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
    roundedDurationMs = applyRounding(rawElapsedMs, settings.rounding)
    billableMs = roundedDurationMs
  }

  const amount = calculateAmount(session, billableMs, settings?.rounding ?? 'none')

  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    endedAt: now,
    status: 'completed',
    pausedTotalMs,
    pausedAt: null,
    amount,
    roundedDurationMs,
  })

  return (await db.sessions.get(sessionId))!
}

/**
 * Pause a running session for payment collection.
 * Sets status='paused', paymentInProgress=true, records pausedAt.
 * Returns the frozen billableMs and grandTotal so the payment screen
 * can display the exact amount that will be written on confirm.
 * Does NOT write endedAt or amount — those are written only in confirmPaymentAndStop.
 */
export async function pauseForPayment(
  sessionId: string,
): Promise<{ billableMs: number; grandTotal: number }> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'running' && session.status !== 'paused') {
    throw new Error('Session is not active')
  }

  const now = Date.now()
  // If already paused mid-game, fold the existing pause first
  let pausedTotalMs = session.pausedTotalMs
  if (session.status === 'paused' && session.pausedAt !== null) {
    pausedTotalMs += now - session.pausedAt
  }

  const rawElapsedMs = now - session.startedAt - pausedTotalMs
  const settings = await db.settings.get(1)
  const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
  let billableMs = rawElapsedMs
  if (!isRateCard && session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
    billableMs = applyRounding(rawElapsedMs, settings.rounding)
  }
  const tableAmt = calculateAmount(session, billableMs, settings?.rounding ?? 'none')
  // #124 — soft-deleted items never count toward a bill
  const sessionItems = await db.sessionItems
    .where('sessionId')
    .equals(sessionId)
    .filter((i) => !i.deletedAt)
    .toArray()
  const itemsTotal = sessionItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const grandTotal = tableAmt + itemsTotal

  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    status: 'paused',
    pausedAt: now,
    pausedTotalMs,
    paymentInProgress: true,
  })

  return { billableMs, grandTotal }
}

/**
 * Atomically stop a session AND record its payment breakdown.
 * Only valid when session.paymentInProgress === true (set by pauseForPayment).
 * Writes endedAt, status='completed', amount, roundedDurationMs, paymentBreakdown
 * in a single Dexie transaction. Wallet debit inlined in the same tx (Pattern D7).
 */
export async function confirmPaymentAndStop(
  sessionId: string,
  breakdown: { cash: number; upi: number; wallet: number },
  customerId?: string,
): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.length !== 36) {
    throw new Error(`confirmPaymentAndStop: invalid sessionId (got ${typeof sessionId} "${sessionId}")`)
  }
  const { cash, upi, wallet } = breakdown
  if (
    !Number.isInteger(cash) || cash < 0 ||
    !Number.isInteger(upi) || upi < 0 ||
    !Number.isInteger(wallet) || wallet < 0
  ) {
    throw new PaymentBreakdownInvalidError('Cash, UPI, and wallet must be non-negative integers.')
  }
  if (wallet > 0 && !customerId) {
    throw new PaymentBreakdownInvalidError('A linked customer is required for wallet payments.')
  }

  // #122/Group B — settings is NOT a synced table, so its read is HOISTED
  // before the batch (rounding is DB-static config, not part of the atomic
  // wallet/session guarantee). Every synced read+write stays inside the batch.
  const settings = await db.settings.get(1)

  // One atomic syncable op: session close + optional wallet-debit ledger INSERT
  // + customer balance UPDATE. The wallet debit MUST stay atomic with the
  // session completion (power-cut guarantee).
  await syncedBatch(
    ['sessions', 'session_items', 'customers', 'wallet_transactions'],
    async (b) => {
      const session = await db.sessions.get(sessionId)
      if (!session) throw new Error(`Session ${sessionId} not found`)
      if (!session.paymentInProgress) {
        throw new PaymentBreakdownInvalidError('Session is not in payment-in-progress state.')
      }

      const now = Date.now()
      // Fold any remaining pause time (pauseForPayment set pausedAt=now, so delta≈0 in practice)
      let pausedTotalMs = session.pausedTotalMs
      if (session.pausedAt !== null) {
        pausedTotalMs += now - session.pausedAt
      }

      const rawElapsedMs = now - session.startedAt - pausedTotalMs
      const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
      let billableMs = rawElapsedMs
      let roundedDurationMs: number | undefined
      if (!isRateCard && session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
        roundedDurationMs = applyRounding(rawElapsedMs, settings.rounding)
        billableMs = roundedDurationMs
      }
      const amount = calculateAmount(session, billableMs, settings?.rounding ?? 'none')

      // #124 — soft-deleted items never count toward a bill
      const sessionItems = await db.sessionItems
        .where('sessionId')
        .equals(sessionId)
        .filter((i) => !i.deletedAt)
        .toArray()
      const itemsTotal = sessionItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
      const grandTotal = amount + itemsTotal

      if (cash + upi + wallet !== grandTotal) {
        throw new PaymentBreakdownInvalidError(
          `Breakdown sum ₹${cash + upi + wallet} does not match total ₹${grandTotal}.`,
        )
      }

      if (wallet > 0) {
        const customer = await db.customers.get(customerId!)
        if (!customer) throw new Error('Customer not found')
        if (customer.walletBalance < wallet) {
          throw new WalletInsufficientError(customer.walletBalance, wallet)
        }
        const newBalance = customer.walletBalance - wallet
        await b.insert('wallet_transactions', {
          id: crypto.randomUUID(),
          customerId: customer.id,
          type: 'debit',
          amount: wallet,
          balanceAfter: newBalance,
          paymentMode: null,
          referenceType: 'session',
          referenceId: sessionId.toString(),
          notes: null,
          createdAt: now,
        } as WalletTransaction)
        await b.update('customers', customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      await b.update('sessions', sessionId, {
        endedAt: now,
        status: 'completed',
        pausedTotalMs,
        pausedAt: null,
        amount,
        roundedDurationMs,
        paymentBreakdown: { cash, upi, wallet },
        paymentInProgress: false,
      })
    },
  )
}

/**
 * Cancel a payment-in-progress pause and resume the session as running.
 * Only valid when session.paymentInProgress === true.
 */
export async function cancelPaymentAndResume(sessionId: string): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (!session.paymentInProgress || session.pausedAt === null) return

  const delta = Date.now() - session.pausedAt
  await syncedUpdate<Session & { id: string }>('sessions', sessionId, {
    status: 'running',
    pausedTotalMs: session.pausedTotalMs + delta,
    pausedAt: null,
    paymentInProgress: false,
  })
}

export async function editSessionStart(
  sessionId: string,
  newStartedAt: number,
): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  const now = Date.now()
  if (newStartedAt >= now) {
    throw new Error('Start time must be in the past')
  }
  if (session.endedAt !== null && newStartedAt >= session.endedAt) {
    throw new Error('Start time must be before end time')
  }

  // For a COMPLETED session, `amount` is a STORED value frozen at stop time —
  // moving the start time changes the billable duration, so we MUST recompute
  // it (and roundedDurationMs) with the exact same logic as stopSession, or the
  // bill shows the stale amount while the elapsed clock shows the new duration
  // (the "edited start but ₹ didn't change" bug). Running/paused sessions
  // compute amount live in the render body (Pattern T4), so they need only the
  // startedAt write — their amount follows automatically.
  const patch: Partial<Session> = { startedAt: newStartedAt }
  if (session.status === 'completed' && session.endedAt !== null) {
    const rawElapsedMs = session.endedAt - newStartedAt - session.pausedTotalMs
    const settings = await db.settings.get(1)
    const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
    let billableMs = rawElapsedMs
    let roundedDurationMs: number | undefined
    if (!isRateCard && session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
      roundedDurationMs = applyRounding(rawElapsedMs, settings.rounding)
      billableMs = roundedDurationMs
    }
    patch.amount = calculateAmount(session, billableMs, settings?.rounding ?? 'none')
    patch.roundedDurationMs = roundedDurationMs
  }

  await syncedUpdate<Session & { id: string }>('sessions', sessionId, patch)
}

export async function getTodaysSessions(): Promise<Session[]> {
  const now = new Date()
  const start = startOfDay(now).getTime()
  const end = endOfDay(now).getTime()
  return db.sessions
    .where('startedAt')
    .between(start, end, true, true)
    .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded
    .toArray()
}

export async function getSessionsBetween(
  start: number,
  end: number,
): Promise<Session[]> {
  return db.sessions
    .where('startedAt')
    .between(start, end, true, true)
    .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded
    .toArray()
}

export async function getRecentPlayerNames(limit = 10): Promise<string[]> {
  const recent = await db.sessions
    .orderBy('startedAt')
    .reverse()
    .limit(100)
    .toArray()

  const seen = new Set<string>()
  const names: string[] = []
  for (const s of recent) {
    if (!s.playerName) continue
    const trimmed = s.playerName.trim()
    if (!trimmed || seen.has(trimmed)) continue
    if (!validatePlayerName(trimmed).valid) continue
    seen.add(trimmed)
    names.push(trimmed)
    if (names.length >= limit) break
  }
  return names
}

export async function updateSession(
  id: string,
  data: Partial<Omit<Session, 'id'>>,
): Promise<void> {
  await syncedUpdate<Session & { id: string }>('sessions', id, data)
}

// ─── Bulk data operations ─────────────────────────────────────────────────────

export async function clearAllSessions(): Promise<void> {
  await db.sessions.clear()
}

export class ActiveSessionsPresentError extends Error {
  constructor() {
    super('Stop all active sessions before resetting.')
    this.name = 'ActiveSessionsPresentError'
  }
}

/**
 * Guard shared by the reset flow. Exported so Settings can run it BEFORE the
 * #154 server-side wipe — checking only inside resetEverything() would wipe
 * Supabase and then abort locally, leaving the device out of sync.
 */
export async function assertNoActiveSessions(): Promise<void> {
  const activeCount = await db.sessions
    .where('status')
    .anyOf(['running', 'paused'])
    .count()
  if (activeCount > 0) throw new ActiveSessionsPresentError()
}

export async function resetEverything(): Promise<void> {
  await assertNoActiveSessions()

  await db.transaction(
    'rw',
    [
      db.gameTables,
      db.sessions,
      db.sessionItems,
      db.settings,
      db.customers,
      db.walletTransactions,
      db.canteenItems,
      db.canteenSales,
      db.stockPurchases,
      db.bookings,
      db._outbox,
    ],
    async () => {
      await Promise.all([
        db.gameTables.clear(),
        db.sessions.clear(),
        db.sessionItems.clear(),
        db.settings.clear(),
        db.customers.clear(),
        db.walletTransactions.clear(),
        db.canteenItems.clear(),
        db.canteenSales.clear(),
        db.stockPurchases.clear(),
        db.bookings.clear(),
        db._outbox.clear(), // Phase C sync queue — local-only, clear on full reset
      ])
    },
  )
  await seedIfEmpty()
}

export async function getAllDataForExport(): Promise<ClubKeeperBackupV21> {
  const [
    tables,
    sessions,
    sessionItems,
    settings,
    customers,
    walletTransactions,
    canteenItems,
    canteenSales,
    stockPurchases,
    bookings,
  ] = await Promise.all([
    db.gameTables.toArray(),
    db.sessions.toArray(),
    db.sessionItems.toArray(),
    db.settings.get(1),
    db.customers.toArray(),
    db.walletTransactions.toArray(),
    db.canteenItems.toArray(),
    db.canteenSales.toArray(),
    db.stockPurchases.toArray(),
    db.bookings.toArray(),
  ])
  return {
    schemaVersion: 21 as const,
    exportedAt: Date.now(),
    tables,
    sessions,
    sessionItems,
    settings,
    customers,
    walletTransactions,
    canteenItems,
    canteenSales,
    stockPurchases,
    bookings,
  }
}

/** Sessions running or paused that started more than 24 h ago. */
export async function getOrphanedSessions(): Promise<Session[]> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  return db.sessions
    .where('status')
    .anyOf(['running', 'paused'])
    .filter((s) => s.startedAt < cutoff)
    .toArray()
}

// ─── Session Items (POS) ──────────────────────────────────────────────────────

export async function addSessionItem(
  data: Omit<SessionItem, 'id' | 'addedAt'>
): Promise<string> {
  const nameError = validateItemName(data.name)
  if (nameError) throw new Error(nameError)
  if (!Number.isInteger(data.price) || data.price < 0 || data.price > 99999) {
    throw new Error('Price must be 0–99999')
  }
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 99) {
    throw new Error('Quantity must be 1–99')
  }
  // v20: id is caller-supplied. See #107.
  const id = crypto.randomUUID()
  await syncedCreate('session_items', {
    ...data,
    id,
    name: data.name.trim(),
    addedAt: Date.now(),
  } as SessionItem & { id: string })
  return id
}

export class InsufficientStockError extends Error {
  constructor(public available: number, public itemName: string) {
    super(available > 0 ? `Only ${available} in stock` : 'Out of stock')
    this.name = 'InsufficientStockError'
  }
}

// Finds the active canteen item matching a session item by (normalizedName, exactPrice).
// Must be called inside a 'rw' transaction that includes db.canteenItems.
async function findMatchingCanteenItemForRow(
  name: string,
  price: number
): Promise<CanteenItem | null> {
  const normalized = normalizeName(name)
  if (!normalized) return null
  const all = await db.canteenItems.toArray()
  return (
    all.find(
      item =>
        item.isActive === true &&
        item.defaultPrice === price &&
        normalizeName(item.name) === normalized
    ) ?? null
  )
}

export async function updateSessionItem(
  id: string,
  patch: Partial<Pick<SessionItem, 'name' | 'price' | 'quantity'>>
): Promise<void> {
  if (patch.name !== undefined) {
    const err = validateItemName(patch.name)
    if (err) throw new Error(err)
    patch.name = patch.name.trim()
  }
  if (patch.price !== undefined) {
    if (!Number.isInteger(patch.price) || patch.price < 0 || patch.price > 99999) {
      throw new Error('Price must be 0–99999')
    }
  }
  if (patch.quantity !== undefined) {
    if (!Number.isInteger(patch.quantity) || patch.quantity < 1 || patch.quantity > 99) {
      throw new Error('Quantity must be 1–99')
    }
  }
  // #122 — session_items update + conditional canteen_items stock update, one
  // atomic syncable op. The stock read (findMatchingCanteenItemForRow →
  // canteenItems.toArray) stays inside the tx so the sufficiency check and the
  // decrement can't race a concurrent writer.
  await syncedBatch(['session_items', 'canteen_items'], async (b) => {
    const existing = await db.sessionItems.get(id)
    if (!existing) throw new Error('Session item not found')

    const newQuantity = patch.quantity ?? existing.quantity
    const qtyDelta = newQuantity - existing.quantity

    if (qtyDelta !== 0) {
      // Stock match uses the ROW's original name+price (not the patched values)
      const matched = await findMatchingCanteenItemForRow(existing.name, existing.price)
      if (matched && matched.stockEnabled === true && matched.id !== undefined) {
        const currentStock = matched.currentStock ?? 0
        const newStock = currentStock - qtyDelta // qty-up → stock down; qty-down → stock up
        if (newStock < 0) {
          throw new InsufficientStockError(currentStock, matched.name)
        }
        await b.update('canteen_items', matched.id, { currentStock: newStock })
      }
    }

    await b.update('session_items', id, patch)
  })
}

export async function deleteSessionItem(id: string): Promise<void> {
  // #124 — SOFT delete. A hard db.sessionItems.delete() cannot round-trip
  // through sync (outbox ops are insert/update/soft_delete; Supabase RLS has
  // no DELETE policy). Restock + tombstone in one atomic syncable op
  // (Pattern S24): the callback reads session_items (get) + canteen_items
  // (match scan) and writes both — exactly those two ride the tables list.
  // Every session_items reader filters !row.deletedAt (#124 invariant).
  await syncedBatch(['session_items', 'canteen_items'], async (b) => {
    const existing = await db.sessionItems.get(id)
    // Idempotent — missing or already tombstoned. Without the deletedAt
    // check a double-delete would restock the same quantity twice.
    if (!existing || existing.deletedAt) return

    const matched = await findMatchingCanteenItemForRow(existing.name, existing.price)
    if (matched && matched.stockEnabled === true && matched.id !== undefined) {
      const currentStock = matched.currentStock ?? 0
      await b.update('canteen_items', matched.id, {
        currentStock: currentStock + existing.quantity,
      })
    }

    await b.softDelete('session_items', id)
  })
}

export async function restoreSessionItem(item: SessionItem): Promise<void> {
  // #124 — Undo clears the tombstone on the SAME row id (the soft-deleted row
  // is still in Dexie). A fresh-UUID insert would leave peers with the
  // tombstone AND a duplicate. The un-delete rides op 'update' — the full
  // merged row incl. deletedAt: null — because the soft_delete push op can
  // only SET deleted_at, never clear it; the session_items payload mapper
  // emits an explicit `deleted_at: null` for this. Wrapper stamps updatedAt.
  const id = item.id
  if (!id) throw new Error('restoreSessionItem: item has no id')
  await syncedBatch(['session_items', 'canteen_items'], async (b) => {
    const existing = await db.sessionItems.get(id)
    // Idempotent — missing or not tombstoned. Without the deletedAt check a
    // double-undo would decrement stock twice.
    if (!existing || !existing.deletedAt) return

    const matched = await findMatchingCanteenItemForRow(item.name, item.price)
    if (matched && matched.stockEnabled === true && matched.id !== undefined) {
      const currentStock = matched.currentStock ?? 0
      const newStock = currentStock - item.quantity
      if (newStock < 0) {
        throw new InsufficientStockError(currentStock, matched.name)
      }
      await b.update('canteen_items', matched.id, { currentStock: newStock })
    }

    await b.update('session_items', id, { deletedAt: null })
  })
}

/**
 * Add a session item OR increment qty on an existing matching row.
 * Match key: same sessionId + normalizeName(name) + exact price.
 *
 * IMPORTANT: Do NOT call this from inside an outer db.transaction() that
 * includes db.sessionItems — its internal tx would partial-write (Pattern D7).
 * For canteen-matched adds, INLINE the merge logic inside the outer tx instead.
 * This helper is for the freeform (sessionItems-only) path.
 */
export async function addOrIncrementSessionItem(input: {
  sessionId: string
  name: string
  price: number
  quantity: number
}): Promise<string> {
  const { sessionId, name, price, quantity } = input
  const normalized = normalizeName(name)

  // Group B — single-table read-then-write (find existing → update qty, else
  // insert). syncedBatch returns void, so capture the target id in an outer var.
  let resultId = ''
  await syncedBatch(['session_items'], async (b) => {
    // #124 — !deletedAt: matching a tombstoned row would increment an
    // invisible item instead of inserting a visible one
    const existing = await db.sessionItems
      .where('sessionId')
      .equals(sessionId)
      .filter(item => !item.deletedAt && normalizeName(item.name) === normalized && item.price === price)
      .first()

    if (existing && existing.id != null) {
      const newQty = Math.min(99, existing.quantity + quantity)
      await b.update('session_items', existing.id, { quantity: newQty })
      resultId = existing.id
      return
    }

    // v20: id is caller-supplied. See #107.
    const id = crypto.randomUUID()
    await b.insert('session_items', {
      id,
      sessionId,
      name: name.trim(),
      price,
      quantity,
      addedAt: Date.now(),
    } as SessionItem & { id: string })
    resultId = id
  })
  return resultId
}

export interface RecentItem {
  name: string
  lastPrice: number
  useCount: number
}

export async function getRecentItems(limit = 8): Promise<RecentItem[]> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const items = await db.sessionItems
    .where('addedAt')
    .above(thirtyDaysAgo)
    .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
    .toArray()

  // Group by name (case-insensitive), keep most recent price, count uses
  const map = new Map<string, { name: string; lastPrice: number; lastAt: number; useCount: number }>()
  for (const item of items) {
    const key = item.name.trim().toLowerCase()
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        name: item.name.trim(),
        lastPrice: item.price,
        lastAt: item.addedAt,
        useCount: 1,
      })
    } else {
      existing.useCount += 1
      if (item.addedAt > existing.lastAt) {
        existing.lastPrice = item.price
        existing.lastAt = item.addedAt
        existing.name = item.name.trim() // preserve casing of most recent
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.useCount - a.useCount || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map(({ name, lastPrice, useCount }) => ({ name, lastPrice, useCount }))
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<ClubSettings> {
  const settings = await db.settings.get(1)
  if (!settings) throw new Error('Settings not initialised — run seedIfEmpty() first')
  return settings
}

export async function updateSettings(
  data: Partial<Omit<ClubSettings, 'id'>>,
): Promise<void> {
  await db.settings.update(1, data)
}

// ─── Canteen Items ─────────────────────────────────────────────────────────────

export async function getCanteenItems(includeInactive = false): Promise<CanteenItem[]> {
  if (includeInactive) {
    return db.canteenItems.orderBy('sortOrder').toArray()
  }
  // Use filter() instead of .where('isActive').equals(1) — IndexedDB stores booleans
  // as booleans, not integers, so equality index queries against a boolean column are
  // unreliable. filter() reads all rows (tiny table) and is safe across all browsers.
  return db.canteenItems
    .orderBy('sortOrder')
    .filter((item) => item.isActive === true)
    .toArray()
}

export async function addCanteenItem(
  input: Omit<CanteenItem, 'id' | 'createdAt' | 'sortOrder' | 'isActive'>,
): Promise<string> {
  const nameValidation = validateCanteenItemName(input.name)
  if (!nameValidation.valid) throw new Error(nameValidation.error)

  const trimmedName = input.name.trim()

  // Reject duplicate active name (case-insensitive)
  const existing = await db.canteenItems
    .filter((item) => item.isActive && item.name.trim().toLowerCase() === trimmedName.toLowerCase())
    .first()
  if (existing) throw new Error(`An active item named "${existing.name}" already exists`)

  // Validate stock fields
  const stockEnabled = input.stockEnabled
  let currentStock = input.currentStock
  if (!stockEnabled) {
    currentStock = null
  } else if (currentStock === null) {
    throw new Error('Stock count required when tracking enabled')
  }

  // Determine next sortOrder
  const last = await db.canteenItems.orderBy('sortOrder').last()
  const sortOrder = last ? last.sortOrder + 1 : 1

  // v20: id is caller-supplied. See #107.
  const id = crypto.randomUUID()
  await syncedCreate('canteen_items', {
    id,
    name: trimmedName,
    defaultPrice: input.defaultPrice,
    stockEnabled,
    currentStock,
    isActive: true,
    createdAt: Date.now(),
    sortOrder,
    ...(typeof input.peakPrice === 'number' ? { peakPrice: input.peakPrice } : {}),
  })
  return id
}

export async function updateCanteenItem(
  id: string,
  patch: Partial<CanteenItem>,
): Promise<void> {
  const item = await db.canteenItems.get(id)
  if (!item) throw new Error(`Canteen item ${id} not found`)

  if (patch.name !== undefined) {
    const nameValidation = validateCanteenItemName(patch.name)
    if (!nameValidation.valid) throw new Error(nameValidation.error)
    const trimmedName = patch.name.trim()
    patch.name = trimmedName
    // Reject duplicate active name (case-insensitive, excluding this id)
    const duplicate = await db.canteenItems
      .filter(
        (i) =>
          i.isActive &&
          i.id !== id &&
          i.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
      .first()
    if (duplicate) throw new Error(`An active item named "${duplicate.name}" already exists`)
  }

  // Resolve effective stockEnabled after patch
  const newStockEnabled = patch.stockEnabled ?? item.stockEnabled
  const oldStockEnabled = item.stockEnabled

  let currentStock = patch.currentStock ?? item.currentStock

  if (oldStockEnabled && !newStockEnabled) {
    // flipped true→false: force null
    currentStock = null
  } else if (!oldStockEnabled && newStockEnabled) {
    // flipped false→true: require currentStock in patch
    if (patch.currentStock === undefined || patch.currentStock === null) {
      throw new Error('Stock count required when tracking enabled')
    }
    currentStock = patch.currentStock
  } else if (newStockEnabled && currentStock === null) {
    throw new Error('Stock count required when tracking enabled')
  } else if (!newStockEnabled) {
    currentStock = null
  }

  await syncedUpdate<CanteenItem & { id: string }>('canteen_items', id, {
    ...patch,
    currentStock,
  })
}

// Business-level soft delete (isActive flag) — stays a syncedUpdate, NOT
// syncedSoftDelete: `deletedAt` is the sync tombstone, `isActive` is the
// user-facing "disabled item" state and must remain independently togglable.
export async function softDeleteCanteenItem(id: string): Promise<void> {
  await syncedUpdate<CanteenItem & { id: string }>('canteen_items', id, {
    isActive: false,
  })
}

/**
 * Bulk-set peak prices across multiple canteen items.
 * (#68 Phase 4 — used by BulkPeakPriceModal.)
 *
 * Pass `peakPrice: undefined` (or omit) to clear the field on an item.
 * Validation: any non-undefined value must be an integer 1-9999.
 *
 * Phase C (Chunk 7): one syncedUpdate per row (each opens its own tx —
 * Pattern D7 forbids wrapping them in an outer tx). Rows are independent
 * (no cross-row invariant), so a mid-loop failure leaving earlier rows
 * applied is acceptable. Clearing merges `peakPrice: undefined` into the
 * stored row — value-identical to a stripped key for every consumer, and
 * the payload mapper sends explicit `peak_price: NULL` so the clear syncs.
 */
export async function bulkSetCanteenItemPeakPrices(
  patches: { id: string; peakPrice?: number }[],
): Promise<void> {
  // Pre-validate up front so a bad row aborts before any write.
  for (const p of patches) {
    if (p.peakPrice !== undefined) {
      if (!Number.isInteger(p.peakPrice) || p.peakPrice < 1 || p.peakPrice > 9999) {
        throw new Error(`Peak price for item ${p.id} must be a whole number between 1 and 9999`)
      }
    }
  }
  for (const p of patches) {
    const row = await db.canteenItems.get(p.id)
    if (!row) continue
    await syncedUpdate<CanteenItem & { id: string }>('canteen_items', p.id, {
      peakPrice: p.peakPrice,
    })
  }
}

export async function decrementCanteenItemStock(
  id: string,
  quantity: number,
): Promise<{ oldStock: number; newStock: number }> {
  // Phase C (Chunk 7): read-check, then syncedUpdate (which owns its own tx —
  // Pattern D7). The check→write pair is no longer a single tx; acceptable on
  // a single-user local DB, and this helper currently has zero callers (kept
  // for standalone use per Pattern D7 — never call it from inside another tx).
  const item = await db.canteenItems.get(id)
  if (!item) throw new Error(`Canteen item ${id} not found`)
  if (!item.stockEnabled) throw new Error('Stock not tracked on this item')
  const oldStock = item.currentStock!
  if (oldStock < quantity) throw new Error('Insufficient stock')
  const newStock = oldStock - quantity
  await syncedUpdate<CanteenItem & { id: string }>('canteen_items', id, {
    currentStock: newStock,
  })
  return { oldStock, newStock }
}

export async function getLowStockThreshold(): Promise<number> {
  const settings = await db.settings.get(1)
  return settings?.lowStockThreshold ?? 5
}

// #161 — runaway-session warning threshold in MINUTES. Default 150 (2.5h).
// 0 = feature off (no banner, no auto-alarm). Owner-only, not mirrored.
export const RUNAWAY_MINUTES_DEFAULT = 150
export async function getRunawaySessionMinutes(): Promise<number> {
  const settings = await db.settings.get(1)
  const v = settings?.runawaySessionMinutes
  return typeof v === 'number' && v >= 0 ? v : RUNAWAY_MINUTES_DEFAULT
}

// ─── Table Move ───────────────────────────────────────────────────────────────

export class IncompatibleTableError extends Error {
  constructor() {
    super('This table is no longer compatible. Refreshing list...')
    this.name = 'IncompatibleTableError'
  }
}

export class TableOccupiedError extends Error {
  constructor() {
    super('That table just became occupied. Refreshing list...')
    this.name = 'TableOccupiedError'
  }
}

// ─── Back Entry ───────────────────────────────────────────────────────────────

export class BackEntryOverlapError extends Error {
  conflictingSession: Session;
  constructor(conflicting: Session) {
    super('Back entry overlaps with an existing session on this table')
    this.name = 'BackEntryOverlapError'
    this.conflictingSession = conflicting
  }
}

export interface BackEntryItemInput {
  name: string      // 1–50 chars, trimmed
  price: number     // integer ₹, 1–9999
  quantity: number  // integer, 1–99
}

export interface BackEntryInput {
  tableId: string
  startedAt: number       // Unix ms (past)
  endedAt: number         // Unix ms (> startedAt and ≤ Date.now())
  playerName: string | null
  playerCount: number     // 1–20
  note: string | null
  items?: BackEntryItemInput[]  // optional; defaults to []
}

export async function createBackEntry(input: BackEntryInput): Promise<string> {
  const items = input.items ?? []

  // #122 — settings is NOT a synced table, so it cannot ride syncedBatch's
  // tables list. Read the rounding config BEFORE the batch: it's DB-static
  // config, not part of the atomic overlap/stock guarantee, so hoisting the
  // read out of the tx is safe. Every synced read+write (sessions overlap,
  // gameTables validate, canteenItems stock, sessionItems inserts) stays inside.
  const settings = await db.settings.get(1)
  const rounding = settings?.rounding ?? 'none'

  const sessionId = crypto.randomUUID()

  // ONE atomic syncable op — session + sessionItems inserts + stock updates.
  await syncedBatch(['sessions', 'game_tables', 'canteen_items', 'session_items'], async (b) => {
    // ---- 1. Validate table ----
    const table = await db.gameTables.get(input.tableId)
    if (!table) throw new Error('Table not found')
    if (table.outOfService) throw new Error('Table is out of service')

    // ---- 2. Overlap check (unchanged) ----
    // Two intervals [a,b] and [c,d] overlap iff a < d AND c < b.
    // For active rows (running/paused) treat the open end as Date.now().
    // #162 — exclude REVERSED sessions: a tombstoned (deletedAt) session keeps
    // status:'completed' + its old start/end, so without this filter it would
    // still "occupy" its slot and block the owner from re-entering the corrected
    // session in the same slot — breaking the reverse-then-re-enter recovery flow.
    const candidates = await db.sessions.where('tableId').equals(input.tableId).toArray()
    const conflict = candidates.find((s) => {
      if (s.deletedAt) return false
      const sEnd = s.status === 'completed' ? (s.endedAt ?? 0) : Date.now()
      return s.startedAt < input.endedAt && input.startedAt < sEnd
    })
    if (conflict) throw new BackEntryOverlapError(conflict)

    // ---- 3. Build & insert the session row ----
    // Pattern T7 — rate card snapshot triple set together when table has a rate card.
    const proto: Session = {
      tableId: input.tableId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      pausedTotalMs: 0,
      pausedAt: null,
      billingMode: 'per_hour',
      rateSnapshot: table.ratePerHour,
      playerName: input.playerName,
      playerCount: input.playerCount,
      note: input.note,
      framesPlayed: null,
      status: 'completed',
      amount: 0,
      isBackEntry: true,
      rateCardSnapshot: table.rateCard?.length ? table.rateCard : undefined,
      toleranceMinutesSnapshot: table.rateCard?.length ? (table.toleranceMinutes ?? 10) : undefined,
      rateCardBillingSnapshot: table.rateCard?.length ? (table.rateCardBilling ?? 'prorated') : undefined,
    }
    const elapsedMs = input.endedAt - input.startedAt
    proto.amount = calculateAmount(proto, elapsedMs, rounding)

    // v20: id is caller-supplied (minted above, before the batch). See #107.
    await b.insert('sessions', { ...proto, id: sessionId })

    // ---- 4. Process items INLINE (Pattern D7 — no calls to addSessionItem /
    //         addOrIncrementSessionItem / decrementCanteenItemStock from inside this tx) ----
    if (items.length > 0) {
      // Load all active canteen items once — use .filter not .where('isActive').equals(1) (Pattern D9)
      const activeCanteen = (await db.canteenItems.toArray()).filter((c) => c.isActive === true)

      // Aggregate stock needs by canteenItem.id so multiple rows for the same item
      // do not each independently pass a single insufficient-stock check.
      const stockNeeded = new Map<string, number>() // canteenItemId → totalQty needed

      // First pass: match items and build the stock-needs map.
      const resolved: Array<{ item: BackEntryItemInput; canteenId?: string }> = []
      for (const it of items) {
        const match = findMatchingCanteenItem(it.name, it.price, activeCanteen)
        if (match && match.stockEnabled && match.id !== undefined) {
          stockNeeded.set(match.id, (stockNeeded.get(match.id) ?? 0) + it.quantity)
          resolved.push({ item: it, canteenId: match.id })
        } else {
          resolved.push({ item: it })
        }
      }

      // Stock sufficiency check — single pass over aggregated map.
      for (const [canteenId, totalQty] of stockNeeded) {
        const live = await db.canteenItems.get(canteenId)
        if (!live || !live.isActive || !live.stockEnabled) continue
        const current = live.currentStock ?? 0
        if (current - totalQty < 0) {
          throw new InsufficientStockError(current, live.name)
        }
      }

      // Apply stock decrements.
      for (const [canteenId, totalQty] of stockNeeded) {
        const live = await db.canteenItems.get(canteenId)
        if (!live || !live.isActive || !live.stockEnabled) continue
        await b.update('canteen_items', canteenId, {
          currentStock: (live.currentStock ?? 0) - totalQty,
        })
      }

      // Insert sessionItems rows. addedAt anchored to endedAt - order*1000 so items
      // fall inside the session's time window (no "future" timestamps relative to session).
      let order = 0
      for (const r of resolved) {
        const sessionItemRow: SessionItem = {
          id: crypto.randomUUID(),
          sessionId,
          name: r.item.name.trim(),
          price: r.item.price,
          quantity: r.item.quantity,
          addedAt: input.endedAt - order * 1000,
        }
        await b.insert('session_items', sessionItemRow as SessionItem & { id: string })
        order += 1
      }
    }
  })

  return sessionId
}

export async function moveSessionToTable(
  sessionId: string,
  toTableId: string,
): Promise<void> {
  // Group B — sessions UPDATE with a cross-table read of game_tables (validation
  // + occupancy race guard). game_tables is READ-only here; only sessions is
  // written. Both tables declared so the reads join the batch tx.
  await syncedBatch(['sessions', 'game_tables'], async (b) => {
    const session = await db.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.status !== 'running' && session.status !== 'paused') {
      throw new Error('Session is not active')
    }

    const fromTableId = session.tableId
    const [srcTable, destTable] = await Promise.all([
      db.gameTables.get(fromTableId),
      db.gameTables.get(toTableId),
    ])

    if (!destTable || destTable.outOfService) throw new IncompatibleTableError()

    // Full compatibility: gameType + billingMode + rate
    const rateMatches =
      session.billingMode === 'per_hour'
        ? srcTable?.ratePerHour === destTable.ratePerHour
        : (srcTable?.ratePerFrame ?? 0) === (destTable.ratePerFrame ?? 0)

    if (
      srcTable?.gameType !== destTable.gameType ||
      rateMatches === false
    ) {
      throw new IncompatibleTableError()
    }

    // Rate card compatibility (Pattern T7 + T8): if either table has a rate card,
    // all three rate-card fields must match exactly — billing mode, tolerance, and
    // every tier's minutes + price. A session moved to a table with a different
    // billing algorithm would produce a silently wrong bill.
    const srcHasCard = (srcTable?.rateCard?.length ?? 0) > 0
    const destHasCard = (destTable.rateCard?.length ?? 0) > 0
    if (srcHasCard || destHasCard) {
      const srcTiers = srcTable?.rateCard ?? []
      const destTiers = destTable.rateCard ?? []
      const tiersMatch =
        srcTiers.length === destTiers.length &&
        srcTiers.every((t, i) => t.minutes === destTiers[i].minutes && t.price === destTiers[i].price)
      const billingMatch =
        (srcTable?.rateCardBilling ?? 'prorated') === (destTable.rateCardBilling ?? 'prorated')
      const toleranceMatch =
        (srcTable?.toleranceMinutes ?? 10) === (destTable.toleranceMinutes ?? 10)
      if (!tiersMatch || !billingMatch || !toleranceMatch) {
        throw new IncompatibleTableError()
      }
    }

    // Verify destination is not currently occupied (race condition guard)
    const occupying = await db.sessions
      .where('tableId')
      .equals(toTableId)
      .filter((s) => s.status !== 'completed')
      .first()
    if (occupying) throw new TableOccupiedError()

    const move = { fromTableId, toTableId, movedAt: Date.now() }
    const existingMoves = session.tableMoves ?? []

    await b.update('sessions', sessionId, {
      tableId: toTableId,
      tableMoves: [...existingMoves, move],
    })
  })
}

/**
 * Errors thrown by recordSessionPaymentBreakdown.
 */
export class PaymentBreakdownInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentBreakdownInvalidError'
  }
}

export class WalletInsufficientError extends Error {
  available: number
  requested: number
  constructor(available: number, requested: number) {
    super(`Wallet has ₹${available.toLocaleString('en-IN')}, requested ₹${requested.toLocaleString('en-IN')}.`)
    this.name = 'WalletInsufficientError'
    this.available = available
    this.requested = requested
  }
}

/**
 * Atomically persist a session's paymentBreakdown and, if a wallet portion was
 * used, debit the linked customer's wallet + write a WalletTransaction row.
 *
 * Pre-conditions (validated inside the tx):
 *  - cash, upi, wallet are non-negative integers
 *  - cash + upi + wallet === session.amount EXACTLY
 *  - if wallet > 0: customerId must be provided AND customer.walletBalance >= wallet
 *
 * All writes happen in ONE Dexie transaction (Pattern D7). Inner walletTransactions
 * helpers are inlined here — never call this from inside another transaction.
 */
export async function recordSessionPaymentBreakdown(
  sessionId: string,
  breakdown: { cash: number; upi: number; wallet: number },
  customerId?: string,
): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.length !== 36) {
    throw new Error(`recordSessionPaymentBreakdown: invalid sessionId (got ${typeof sessionId} "${sessionId}")`)
  }
  const { cash, upi, wallet } = breakdown
  if (
    !Number.isInteger(cash) || cash < 0 ||
    !Number.isInteger(upi) || upi < 0 ||
    !Number.isInteger(wallet) || wallet < 0
  ) {
    throw new PaymentBreakdownInvalidError('Cash, UPI, and wallet must be non-negative integers.')
  }
  if (wallet > 0 && !customerId) {
    throw new PaymentBreakdownInvalidError('A linked customer is required for wallet payments.')
  }

  // Group B — one atomic syncable op: paymentBreakdown UPDATE + optional
  // wallet-debit ledger INSERT + customer balance UPDATE, all atomic.
  await syncedBatch(
    ['sessions', 'session_items', 'customers', 'wallet_transactions'],
    async (b) => {
      const session = await db.sessions.get(sessionId)
      if (!session) throw new Error(`Session ${sessionId} not found`)
      if (session.status !== 'completed') {
        throw new PaymentBreakdownInvalidError('Session must be stopped before recording payment.')
      }
      // Grand total = table amount (session.amount) + canteen items total.
      // session.amount is the time-cost only; canteen items live in a separate
      // table and must be summed here so the breakdown invariant matches the
      // total the sheet displayed to the user.
      const sessionItems = await db.sessionItems
        .where('sessionId')
        .equals(sessionId)
        .filter((i) => !i.deletedAt) // #124 — soft-deleted items never count toward a bill
        .toArray()
      const itemsTotal = sessionItems.reduce(
        (sum, i) => sum + i.price * i.quantity,
        0,
      )
      const grandTotal = session.amount + itemsTotal
      if (cash + upi + wallet !== grandTotal) {
        throw new PaymentBreakdownInvalidError(
          `Breakdown sum ₹${cash + upi + wallet} does not match total ₹${grandTotal}.`,
        )
      }

      if (wallet > 0) {
        const customer = await db.customers.get(customerId!)
        if (!customer) throw new Error('Customer not found')
        if (customer.walletBalance < wallet) {
          throw new WalletInsufficientError(customer.walletBalance, wallet)
        }
        const now = Date.now()
        const newBalance = customer.walletBalance - wallet
        await b.insert('wallet_transactions', {
          id: crypto.randomUUID(),
          customerId: customer.id,
          type: 'debit',
          amount: wallet,
          balanceAfter: newBalance,
          paymentMode: null,
          referenceType: 'session',
          referenceId: sessionId.toString(),
          notes: null,
          createdAt: now,
        } as WalletTransaction)
        await b.update('customers', customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      await b.update('sessions', sessionId, {
        paymentBreakdown: { cash, upi, wallet },
      })
    },
  )
}

/** Thrown by reverseSession when the target isn't a reversible completed session. */
export class SessionReversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionReversalError'
  }
}

/**
 * #162 — OWNER-ONLY: fully reverse a completed session, as if it never
 * happened, then the owner re-enters the correct one via Back Entry.
 *
 * All in ONE atomic syncedBatch (power-cut / partial-write safe):
 *  1. Soft-delete the session (tombstone via b.update so the audit fields ride
 *     the same push) + soft-delete each of its (non-deleted) session_items.
 *     The tombstone removes it from EVERY completed-session reader (guarded in
 *     task #4) → it leaves Summary, piggy cash-in, today's total automatically.
 *  2. Wallet reversal — if the session debited a customer's wallet
 *     (paymentBreakdown.wallet > 0, recorded as a `type:'debit',
 *     referenceType:'session'` row), write a CREDIT reversal row
 *     (referenceType 'reversal') and restore the customer balance. The ledger
 *     is append-only (never soft-delete a wallet_transactions row — S24 rule 4).
 *  3. Stock return — for each item line, re-add its qty to the matching canteen
 *     item's current stock. If the item is no longer in the menu (deleted or
 *     never stock-tracked as a canteen item), re-create/undelete it holding the
 *     returned qty and stamp `revertedStockAt` so the "↩ reverted stock" badge
 *     shows (owner decision — owner can delete it again if unwanted).
 *  4. Piggy self-corrects — its cash-in is derived from completed sessions with
 *     a paymentBreakdown, and the tombstone (step 1) drops this one, so the
 *     session's cash leaves the piggy with NO separate piggy write.
 *
 * Audit: deletedBy (owner uid from the lock-free JWT sub) + deleteReason are
 * stamped on the session so a partner dispute has a record. deletedBy is
 * decoded OUTSIDE the tx (no await/network inside a syncedBatch — S24 rule 3).
 */
export async function reverseSession(sessionId: string, reason?: string): Promise<void> {
  if (typeof sessionId !== 'string' || sessionId.length !== 36) {
    throw new SessionReversalError('Invalid session id.')
  }

  // Owner uid for the audit trail — decoded lock-free BEFORE the tx (no network
  // / auth calls inside a syncedBatch callback; Pattern S16/S24).
  const token = readAccessTokenLockFree()
  const sub = token ? decodeJwtClaims(token).sub : undefined
  const ownerUid = typeof sub === 'string' && sub.length > 0 ? sub : null
  const trimmedReason = reason?.trim() ? reason.trim().slice(0, 200) : null
  const now = Date.now()

  await syncedBatch(
    ['sessions', 'session_items', 'customers', 'wallet_transactions', 'canteen_items'],
    async (b) => {
      const session = await db.sessions.get(sessionId)
      if (!session) throw new SessionReversalError('Session not found.')
      if (session.status !== 'completed') {
        throw new SessionReversalError('Only a completed session can be reversed.')
      }
      if (session.deletedAt) {
        throw new SessionReversalError('This session is already reversed.')
      }

      // ── 1. Tombstone the session (carry audit via update, not softDelete) ──
      await b.update('sessions', sessionId, {
        deletedAt: now,
        deletedBy: ownerUid,
        deleteReason: trimmedReason,
      })

      // ── 2. Item lines: return stock, then soft-delete the line ───────────
      const items = await db.sessionItems
        .where('sessionId')
        .equals(sessionId)
        .filter((i) => !i.deletedAt)
        .toArray()

      // Stock return is done in TWO phases so a canteen item that appears in
      // more than one session line (same item added twice, possibly at
      // different prices) is updated EXACTLY ONCE with the SUMMED qty — a
      // per-line loop over a single stale snapshot would lost-update
      // (only the last line's qty would stick). Phase 1: resolve each line to
      // a target + accumulate returned qty. Phase 2: apply one write per target.
      const canteenItems = await db.canteenItems.toArray()
      const byExistingId = new Map<string, number>() // canteen item id → total qty to return
      const byNewName = new Map<string, { name: string; price: number; qty: number }>() // normalized name → re-create

      for (const line of items) {
        const match =
          findMatchingCanteenItem(line.name, line.price, canteenItems) ??
          canteenItems.find(
            (ci) => normalizeName(ci.name) === normalizeName(line.name),
          ) ??
          null

        if (match?.id && (match.deletedAt || match.stockEnabled)) {
          // Present-but-untracked (stockEnabled===false, not deleted) → skip stock.
          byExistingId.set(match.id, (byExistingId.get(match.id) ?? 0) + line.quantity)
        } else if (!match) {
          const key = normalizeName(line.name)
          const acc = byNewName.get(key)
          if (acc) acc.qty += line.quantity
          else byNewName.set(key, { name: line.name, price: line.price, qty: line.quantity })
        }
        // present + stockEnabled===false → intentionally untracked; no stock op.

        if (line.id) await b.softDelete('session_items', line.id)
      }

      // Phase 2 — one write per resolved target, qty already summed.
      let newSort = (canteenItems.length + 1) * 10
      for (const [id, qty] of byExistingId) {
        const ci = canteenItems.find((c) => c.id === id)!
        if (ci.deletedAt) {
          // Removed from the menu — un-delete to hold the returned stock + badge.
          await b.update('canteen_items', id, {
            deletedAt: null,
            isActive: true,
            stockEnabled: true,
            currentStock: (ci.currentStock ?? 0) + qty,
            revertedStockAt: now,
          })
        } else {
          await b.update('canteen_items', id, {
            currentStock: (ci.currentStock ?? 0) + qty,
          })
        }
      }
      for (const { name, price, qty } of byNewName.values()) {
        // No matching canteen item at all — re-create one to hold the stock,
        // badged as reverted. Owner can delete it if unwanted.
        await b.insert('canteen_items', {
          id: crypto.randomUUID(),
          name,
          defaultPrice: price,
          stockEnabled: true,
          currentStock: qty,
          isActive: true,
          createdAt: now,
          sortOrder: newSort,
          revertedStockAt: now,
        } as CanteenItem & { id: string })
        newSort += 10
      }

      // ── 3. Wallet reversal (if any wallet portion was debited) ────────────
      const walletPaid = session.paymentBreakdown?.wallet ?? 0
      if (walletPaid > 0) {
        // Find the debit row this session wrote, to know which customer to credit.
        const debit = await db.walletTransactions
          .where('referenceId')
          .equals(sessionId)
          .filter((t) => t.referenceType === 'session' && t.type === 'debit')
          .first()
        if (debit?.customerId) {
          const customer = await db.customers.get(debit.customerId)
          if (customer) {
            const newBalance = customer.walletBalance + walletPaid
            await b.insert('wallet_transactions', {
              id: crypto.randomUUID(),
              customerId: customer.id,
              type: 'credit',
              amount: walletPaid,
              balanceAfter: newBalance,
              paymentMode: null,
              referenceType: 'reversal',
              referenceId: sessionId.toString(),
              notes: `Reversal of session ${sessionId.slice(0, 8)}`,
              createdAt: now,
            } as WalletTransaction)
            await b.update('customers', customer.id, { walletBalance: newBalance })
          }
        }
      }
    },
  )
}

/**
 * Errors thrown by createCanteenSale.
 */
export class CanteenSaleInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanteenSaleInvalidError'
  }
}

export class CanteenSaleStockError extends Error {
  itemName: string
  available: number
  constructor(itemName: string, available: number) {
    super(`Insufficient stock for "${itemName}". Available: ${available}.`)
    this.name = 'CanteenSaleStockError'
    this.itemName = itemName
    this.available = available
  }
}

export interface CanteenSaleLineInput {
  canteenItemId: string
  name: string
  price: number
  quantity: number
}

/**
 * Atomically persist a walk-in canteen sale.
 *
 * In ONE flat Dexie transaction (Pattern D7):
 *   1. Aggregate qty across duplicate lines per canteenItemId so the stock
 *      sufficiency check sees the true total per item.
 *   2. For every line whose CanteenItem has stockEnabled=true: decrement
 *      currentStock by the aggregated qty; throws CanteenSaleStockError
 *      (tx rolls back) if any line would push stock negative.
 *   3. Insert the CanteenSale row.
 *   4. If wallet portion > 0: write a WalletTransaction (debit,
 *      referenceType='canteen_sale') AND decrement customer.walletBalance.
 *
 * Invariant: paymentBreakdown.cash + .upi + .wallet === total EXACTLY.
 * customerId is REQUIRED iff wallet > 0.
 */
export async function createCanteenSale(input: {
  items: CanteenSaleLineInput[]
  paymentBreakdown: { cash: number; upi: number; wallet: number }
  customerId?: string
  notes?: string
}): Promise<string> {
  const { cash, upi, wallet } = input.paymentBreakdown
  if (
    !Number.isInteger(cash) || cash < 0 ||
    !Number.isInteger(upi) || upi < 0 ||
    !Number.isInteger(wallet) || wallet < 0
  ) {
    throw new CanteenSaleInvalidError('Cash, UPI, and wallet must be non-negative integers.')
  }
  if (wallet > 0 && !input.customerId) {
    throw new CanteenSaleInvalidError('A linked customer is required for wallet payments.')
  }
  if (input.items.length === 0) {
    throw new CanteenSaleInvalidError('Cannot create an empty canteen sale.')
  }
  // Validate each line
  for (const line of input.items) {
    if (typeof line.canteenItemId !== 'string' || line.canteenItemId.length !== 36) {
      throw new CanteenSaleInvalidError('Invalid canteen item reference.')
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new CanteenSaleInvalidError('Line quantity must be a positive integer.')
    }
    if (!Number.isInteger(line.price) || line.price < 0) {
      throw new CanteenSaleInvalidError('Line price must be a non-negative integer.')
    }
  }

  const subtotal = input.items.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  )
  const total = subtotal
  if (cash + upi + wallet !== total) {
    throw new CanteenSaleInvalidError(
      `Breakdown sum ₹${cash + upi + wallet} does not match total ₹${total}.`,
    )
  }

  // Aggregate qty per canteenItemId for stock sufficiency
  const qtyByItem = new Map<string, number>()
  for (const line of input.items) {
    qtyByItem.set(
      line.canteenItemId,
      (qtyByItem.get(line.canteenItemId) ?? 0) + line.quantity,
    )
  }

  const saleId = crypto.randomUUID()
  const now = Date.now()

  // #122 — one atomic syncable op mixing stock updates + wallet-debit ledger
  // INSERT + customer balance UPDATE + sale-row INSERT. The wallet debit MUST
  // stay atomic with the sale row (power-cut guarantee — a committed debit with
  // a lost sale, or vice versa, is exactly what this wrapper prevents). All
  // reads (stock, customer balance) stay inside the tx so their checks can't
  // race a concurrent writer. wallet_transactions is INSERT-only here — the
  // debit is a ledger row, never a soft-delete (append-only, §4.6).
  await syncedBatch(
    ['canteen_sales', 'canteen_items', 'customers', 'wallet_transactions'],
    async (b) => {
      // Stock decrement (Pattern D7 — inlined; never call decrementCanteenItemStock here)
      for (const [itemId, totalQty] of qtyByItem.entries()) {
        const fresh = await db.canteenItems.get(itemId)
        if (!fresh) {
          throw new CanteenSaleInvalidError(`Canteen item ${itemId} not found.`)
        }
        if (fresh.isActive !== true) {
          throw new CanteenSaleInvalidError(`"${fresh.name}" is no longer available.`)
        }
        if (fresh.stockEnabled === true) {
          const oldStock = fresh.currentStock ?? 0
          const newStock = oldStock - totalQty
          if (newStock < 0) {
            throw new CanteenSaleStockError(fresh.name, oldStock)
          }
          await b.update('canteen_items', itemId, { currentStock: newStock })
        }
      }

      // Wallet debit if applicable
      if (wallet > 0) {
        const customer = await db.customers.get(input.customerId!)
        if (!customer) throw new CanteenSaleInvalidError('Customer not found.')
        if (customer.walletBalance < wallet) {
          throw new WalletInsufficientError(customer.walletBalance, wallet)
        }
        const newBalance = customer.walletBalance - wallet
        await b.insert('wallet_transactions', {
          id: crypto.randomUUID(),
          customerId: customer.id,
          type: 'debit',
          amount: wallet,
          balanceAfter: newBalance,
          paymentMode: null,
          referenceType: 'canteen_sale',
          referenceId: saleId,
          notes: null,
          createdAt: now,
        } as WalletTransaction)
        await b.update('customers', customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      // Insert the sale row last so any earlier throw rolls everything back.
      await b.insert('canteen_sales', {
        id: saleId,
        createdAt: now,
        items: input.items.map((line) => ({
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          canteenItemId: line.canteenItemId,
        })),
        subtotal,
        paymentBreakdown: { cash, upi, wallet },
        total,
        customerId: wallet > 0 ? input.customerId : undefined,
        notes: input.notes && input.notes.trim() ? input.notes.trim().slice(0, 200) : undefined,
      } as CanteenSale)
    },
  )

  return saleId
}

// ─── Split payment / canteen sale / piggy — v13 stubs ────────────────────────
// These query helpers are added in Phase 1 for type safety and to centralise
// aggregation logic. They are NOT wired to any UI yet — Phase 2+ consumers
// will import them. Do not call from components in Phase 1.

/**
 * Return all stopped sessions in [date, date+1day) that have a non-null
 * paymentBreakdown. Used by Summary PAYMENT MODE (Phase 4) and the piggy
 * cash-in aggregation (Phase 5).
 *
 * Excludes running/paused sessions — their breakdown is unknown until stop.
 * Back-entry sessions are included (ADDENDUM-3: treated identically).
 */
export async function getSessionsWithBreakdownByDate(date: Date): Promise<Session[]> {
  const start = startOfDay(date).getTime()
  const end = endOfDay(date).getTime()
  const rows = await db.sessions
    .where('startedAt')
    .between(start, end, true, true)
    .toArray()
  return rows.filter(
    (s) => s.status === 'completed' && s.paymentBreakdown !== undefined && !s.deletedAt, // #162
  )
}

/**
 * Return all canteen sales whose createdAt falls in [date, date+1day).
 * Used by Summary PAYMENT MODE and CANTEEN tile (Phase 3/4) and piggy
 * cash-in aggregation (Phase 5).
 */
export async function getCanteenSalesByDate(date: Date): Promise<CanteenSale[]> {
  const start = startOfDay(date).getTime()
  const end = endOfDay(date).getTime()
  return db.canteenSales
    .where('createdAt')
    .between(start, end, true, true)
    .toArray()
}

/**
 * Compute the current piggy balance.
 *
 * Formula:
 *   current = opening
 *           + Σ Session.paymentBreakdown.cash       for stopped sessions since piggyStartedAt
 *           + Σ CanteenSale.paymentBreakdown.cash   since piggyStartedAt
 *           + Σ WalletTransaction.amount            for type='credit' AND paymentMode='cash' since piggyStartedAt
 *           − Σ StockPurchase.cost                  where source='piggy' since piggyStartedAt
 *
 * Returns negative values as-is — the UI is responsible for clamping the
 * displayed value to ≥ 0 and showing a warning (per Phase 5 spec).
 */
export async function getPiggyBalance(): Promise<{
  opening: number
  cashIn: number
  restockOut: number
  current: number
}> {
  const settings = await db.settings.get(1)
  const opening = settings?.piggyOpeningBalance ?? 0
  const since = settings?.piggyStartedAt ?? 0

  const [sessions, sales, walletCredits, restocks] = await Promise.all([
    db.sessions
      .where('endedAt')
      .aboveOrEqual(since)
      .filter(
        (s) => s.status === 'completed' && s.paymentBreakdown !== undefined && !s.deletedAt, // #162 — reversed sessions leave the piggy cash-in
      )
      .toArray(),
    db.canteenSales.where('createdAt').aboveOrEqual(since).toArray(),
    db.walletTransactions
      .where('createdAt')
      .aboveOrEqual(since)
      .filter((t) => t.type === 'credit' && t.paymentMode === 'cash')
      .toArray(),
    db.stockPurchases
      .where('createdAt')
      .aboveOrEqual(since)
      .filter((p) => p.source === 'piggy')
      .toArray(),
  ])

  const cashFromSessions = sessions.reduce(
    (sum, s) => sum + (s.paymentBreakdown?.cash ?? 0),
    0,
  )
  const cashFromSales = sales.reduce(
    (sum, c) => sum + (c.paymentBreakdown?.cash ?? 0),
    0,
  )
  const cashFromTopups = walletCredits.reduce((sum, t) => sum + t.amount, 0)
  const cashIn = cashFromSessions + cashFromSales + cashFromTopups
  const restockOut = restocks.reduce((sum, p) => sum + p.cost, 0)

  return {
    opening,
    cashIn,
    restockOut,
    current: opening + cashIn - restockOut,
  }
}

/**
 * Return all StockPurchase rows for a given canteen item, newest first.
 * Used by /piggy detail page (Phase 5) and future inventory-cost reports.
 */
export async function listStockPurchasesForItem(
  canteenItemId: number,
): Promise<StockPurchase[]> {
  const rows = await db.stockPurchases
    .where('canteenItemId')
    .equals(canteenItemId)
    .toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * List ALL stock purchases newest-first, optionally filtered by source.
 * Used by /piggy detail page and Summary's STOCK BOUGHT TODAY tile drill-in.
 */
export async function listStockPurchases(opts?: {
  source?: 'piggy' | 'other'
  start?: number
  end?: number
}): Promise<StockPurchase[]> {
  let coll = db.stockPurchases.orderBy('createdAt').reverse()
  if (opts?.start !== undefined || opts?.end !== undefined) {
    const s = opts.start ?? 0
    const e = opts.end ?? Number.MAX_SAFE_INTEGER
    coll = coll.filter((p) => p.createdAt >= s && p.createdAt <= e)
  }
  if (opts?.source) {
    coll = coll.filter((p) => p.source === opts.source)
  }
  return coll.toArray()
}

/**
 * Atomically record a canteen restock.
 *
 * In ONE flat Dexie transaction (Pattern D7):
 *   1. Insert StockPurchase row.
 *   2. If the CanteenItem has stockEnabled=true: increment currentStock by
 *      quantityAdded. If stockEnabled=false: skip the stock change (still
 *      log the purchase — useful for inventory cost reports later).
 *
 * Stock cannot go negative via restock — quantityAdded is required positive
 * and additions can only grow currentStock.
 *
 * Piggy deduction is implicit (computed live by getPiggyBalance) — there's
 * no separate piggy ledger row. The single source of truth is the
 * StockPurchase row + its `source` field.
 */
export class StockPurchaseInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockPurchaseInvalidError'
  }
}

export async function recordStockPurchase(input: {
  canteenItemId: string
  quantityAdded: number
  cost: number
  source: 'piggy' | 'other'
  notes?: string
}): Promise<string> {
  if (typeof input.canteenItemId !== 'string' || input.canteenItemId.length !== 36) {
    throw new StockPurchaseInvalidError('Invalid canteen item.')
  }
  if (!Number.isInteger(input.quantityAdded) || input.quantityAdded <= 0) {
    throw new StockPurchaseInvalidError('Quantity must be a positive integer.')
  }
  if (!Number.isInteger(input.cost) || input.cost < 0) {
    throw new StockPurchaseInvalidError('Cost must be a non-negative integer.')
  }
  if (input.source !== 'piggy' && input.source !== 'other') {
    throw new StockPurchaseInvalidError('Source must be "piggy" or "other".')
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  // #122 — mixed insert (stock_purchases) + update (canteen_items) as one atomic
  // syncable op. The read (canteen_items.get) must stay inside the tx so the
  // stockEnabled decision + the increment can't race a concurrent restock.
  await syncedBatch(['stock_purchases', 'canteen_items'], async (b) => {
    const item = await db.canteenItems.get(input.canteenItemId)
    if (!item) throw new StockPurchaseInvalidError('Canteen item not found.')

    await b.insert('stock_purchases', {
      id,
      canteenItemId: input.canteenItemId,
      quantityAdded: input.quantityAdded,
      cost: input.cost,
      source: input.source,
      createdAt: now,
      notes:
        input.notes && input.notes.trim()
          ? input.notes.trim().slice(0, 200)
          : undefined,
    } as StockPurchase)

    // Stock tracking is optional per item — only mutate when enabled.
    if (item.stockEnabled === true) {
      const oldStock = item.currentStock ?? 0
      await b.update('canteen_items', input.canteenItemId, {
        currentStock: oldStock + input.quantityAdded,
      })
    }
  })

  return id
}

/**
 * Update the owner-settable opening balance for the piggy. Writes the
 * settings singleton in place — no migration / log row. Per Phase 5 spec
 * v1: no edit audit log.
 */
export async function updatePiggyOpeningBalance(newBalance: number): Promise<void> {
  if (!Number.isInteger(newBalance) || newBalance < 0) {
    throw new Error('Opening balance must be a non-negative integer.')
  }
  await db.settings.update(1, { piggyOpeningBalance: newBalance })
}

// ─── ClubCoins — v15 ─────────────────────────────────────────────────────────

/**
 * Return the fully-resolved coin configuration merged with defaults.
 * Every field guaranteed to be defined — callers never need to null-check.
 */
export async function getCoinConfig() {
  const settings = await db.settings.get(1)
  return resolveCoinConfig(settings ?? {})
}

export class InsufficientCoinsError extends Error {
  available: number
  requested: number
  constructor(available: number, requested: number) {
    super(`Insufficient ClubCoins. Available: ${available}, requested: ${requested}.`)
    this.name = 'InsufficientCoinsError'
    this.available = available
    this.requested = requested
  }
}

/**
 * Record a topup: credits the wallet AND, if coinsEnabled, credits coins.
 * Writes 1 or 2 WalletTransaction rows and updates customer in ONE flat tx.
 *
 * Pattern D7: never call this from inside another db.transaction().
 */
export async function recordTopupWithCoins(params: {
  customerId: string
  rupees: number
  paymentMode: 'cash' | 'upi' | 'card'
  refId: string | null
}): Promise<{ coinsEarned: number; welcomeCoinsEarned: number }> {
  const { customerId, rupees, paymentMode, refId } = params
  const config = await getCoinConfig()
  const engagement = await getEngagementConfig()

  const tierCoins = config.coinsEnabled
    ? coinsEarnedForTopup(rupees, config.coinTiers)
    : 0

  // Welcome bonus determined before entering tx (read-only check is safe here;
  // the idempotency guard is re-checked inside the tx on the fresh row).
  const customerPre = await db.customers.get(customerId)
  const isFirstTopup = !customerPre?.firstTopupAt
  const welcomeCoins =
    isFirstTopup && engagement.welcomeBonusEnabled && config.coinsEnabled
      ? (engagement.welcomeBonusCoins ?? 0)
      : 0

  // Group B — wallet credit + up-to-2 coin ledger INSERTs + customer balance
  // UPDATE, all atomic. wallet_transactions is append-only (§4.6): every row is
  // an INSERT (b.insert), never a soft-delete.
  await syncedBatch(['customers', 'wallet_transactions'], async (b) => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('customer_not_found')

    // Re-check idempotency guard inside tx in case of concurrent calls
    const alreadyHadFirstTopup = !!customer.firstTopupAt
    const effectiveWelcomeCoins = alreadyHadFirstTopup ? 0 : welcomeCoins

    const newWalletBalance = customer.walletBalance + rupees
    const now = Date.now()

    // Running coin balance tally (each row records balance AFTER that row)
    let runningCoinBalance = customer.coinBalance ?? 0

    // 1. Wallet credit row
    await b.insert('wallet_transactions', {
      id: crypto.randomUUID(),
      customerId,
      type: 'credit',
      balanceType: 'wallet',
      amount: rupees,
      balanceAfter: newWalletBalance,
      paymentMode,
      referenceType: 'topup',
      referenceId: refId,
      notes: null,
      createdAt: now,
    } as WalletTransaction)

    // 2. Tier coin credit row
    if (tierCoins > 0) {
      runningCoinBalance += tierCoins
      await b.insert('wallet_transactions', {
        id: crypto.randomUUID(),
        customerId,
        type: 'credit',
        balanceType: 'coins',
        amount: 0,
        coinDelta: tierCoins,
        balanceAfter: runningCoinBalance,
        paymentMode: null,
        referenceType: 'topup',
        referenceId: refId,
        notes: `Earned via ₹${rupees.toLocaleString('en-IN')} topup`,
        createdAt: now,
      } as WalletTransaction)
    }

    // 3. Welcome bonus row (first-topup, one-shot)
    if (effectiveWelcomeCoins > 0) {
      runningCoinBalance += effectiveWelcomeCoins
      await b.insert('wallet_transactions', {
        id: crypto.randomUUID(),
        customerId,
        type: 'credit',
        balanceType: 'coins',
        amount: 0,
        coinDelta: effectiveWelcomeCoins,
        balanceAfter: runningCoinBalance,
        paymentMode: null,
        referenceType: 'welcome_bonus',
        referenceId: null,
        notes: 'Welcome bonus — first topup',
        createdAt: now,
      } as WalletTransaction)
    }

    await b.update('customers', customerId, {
      walletBalance: newWalletBalance,
      coinBalance: runningCoinBalance,
      lastVisitAt: now,
      // Stamp firstTopupAt on first topup only — never overwrite
      ...(alreadyHadFirstTopup ? {} : { firstTopupAt: now }),
    })
  })

  return { coinsEarned: tierCoins, welcomeCoinsEarned: welcomeCoins }
}

/**
 * Redeem coins from a customer — writes a WalletTransaction(coins, debit)
 * row and decrements coinBalance. The ₹ discount is NOT applied here;
 * the caller (post-stop or canteen checkout) applies it to the bill.
 *
 * Pattern D7: never call from inside another db.transaction().
 */
export async function redeemCoins(params: {
  customerId: string
  coins: number
  rupeeEquivalent: number
  referenceType: 'coin_redemption'
  referenceId: string
}): Promise<void> {
  const { customerId, coins, rupeeEquivalent, referenceType, referenceId } = params
  if (!Number.isInteger(coins) || coins <= 0) throw new Error('Coins must be a positive integer.')

  // Group B — coin-debit ledger INSERT + customer coinBalance UPDATE, atomic.
  // Append-only ledger (§4.6): the redemption is an INSERT, never a soft-delete.
  await syncedBatch(['customers', 'wallet_transactions'], async (b) => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('customer_not_found')

    const currentCoins = customer.coinBalance ?? 0
    if (currentCoins < coins) throw new InsufficientCoinsError(currentCoins, coins)

    const newCoinBalance = currentCoins - coins

    await b.insert('wallet_transactions', {
      id: crypto.randomUUID(),
      customerId,
      type: 'debit',
      balanceType: 'coins',
      amount: 0,
      coinDelta: -coins,
      rupeeEquivalent,
      balanceAfter: newCoinBalance,
      paymentMode: null,
      referenceType,
      referenceId,
      notes: `Redeemed for ₹${rupeeEquivalent.toLocaleString('en-IN')} discount`,
      createdAt: Date.now(),
    } as WalletTransaction)

    await b.update('customers', customerId, {
      coinBalance: newCoinBalance,
      lastVisitAt: Date.now(),
    })
  })
}

// ─── v17 Phase 1 P1e — Advance booking session linkage ───────────────────────

export class BookingAlreadyConsumedError extends Error {
  constructor() {
    super('This booking has already been linked to a session.')
    this.name = 'BookingAlreadyConsumedError'
  }
}

/**
 * Find confirmed bookings whose slotStart is within ±windowMs of `now` for a
 * given table. Used by StartSession on mount to surface a "Booking found"
 * prompt. Excludes anything already consumed/cancelled/no_show.
 */
export async function getLinkableBookingsForTable(
  tableId: string,
  now: number,
  windowMs: number,
): Promise<Booking[]> {
  const low = now - windowMs
  const high = now + windowMs
  return db.bookings
    .where('[tableId+slotStart]')
    .between([tableId, low], [tableId, high], true, true)
    .filter((b) => b.status === 'confirmed' && b.consumedSessionId === undefined)
    .toArray()
}

/**
 * Find confirmed bookings on a table whose slotStart falls inside (now, now+lookaheadMs].
 * Used by StartSession to render a walk-in conflict warning when staff is about
 * to start a session on a table that has an upcoming reservation. Warn-only —
 * never blocks the walk-in.
 */
export async function getUpcomingBookingsForTable(
  tableId: string,
  now: number,
  lookaheadMs: number,
): Promise<Booking[]> {
  return db.bookings
    .where('[tableId+slotStart]')
    .between([tableId, now], [tableId, now + lookaheadMs], false, true)
    .filter((b) => b.status === 'confirmed' && b.consumedSessionId === undefined)
    .toArray()
}

/**
 * Atomically attach a confirmed booking to a session.
 *
 * - Marks booking.status = 'consumed' and sets booking.consumedSessionId.
 * - If a customer exists by playerPhone, returns customerId; otherwise creates
 *   one and returns its id so the caller can link it in PaymentSplitSheet.
 *
 * Single flat tx (Pattern D7). Throws BookingAlreadyConsumedError if the
 * booking was raced to 'consumed' by a parallel link attempt.
 */
export async function linkBookingToSession(
  bookingId: string,
  sessionId: string,
): Promise<{ customerId: string }> {
  // Group B — bookings UPDATE + customer lookup-or-create (INSERT or UPDATE),
  // atomic. syncedBatch returns void, so capture the resolved customerId outside.
  let resolvedCustomerId = ''
  await syncedBatch(['bookings', 'customers'], async (b) => {
    const booking = await db.bookings.get(bookingId)
    if (!booking) throw new Error('Booking not found.')
    if (booking.status !== 'confirmed' || booking.consumedSessionId !== undefined) {
      throw new BookingAlreadyConsumedError()
    }

    // Customer lookup-or-create by phone. We do NOT touch walletBalance here;
    // the advance gets applied at payment time via PaymentSplitSheet.
    // #153: booking.playerPhone is bare 10 digits — normalize to the canonical
    // '+91' Customer.phone format for both lookup and create, and heal legacy
    // bare-format rows on touch (only when no canonical row already exists).
    const canonicalPhone = toCustomerPhone(booking.playerPhone)
    const matches = await db.customers
      .where('phone').anyOf(phoneLookupCandidates(booking.playerPhone)).toArray()
    const customer = preferCanonicalPhone(matches, booking.playerPhone)
    if (!customer) {
      const now = Date.now()
      const newCustomer = {
        id: crypto.randomUUID(),
        phone: canonicalPhone,
        name: booking.playerName?.trim() || null,
        walkInCode: null,
        walletBalance: 0,
        createdAt: now,
        lastVisitAt: now,
      }
      await b.insert('customers', newCustomer as Customer & { id: string })
      resolvedCustomerId = newCustomer.id
    } else {
      const heal = customer.phone !== canonicalPhone ? { phone: canonicalPhone } : {}
      await b.update('customers', customer.id, { lastVisitAt: Date.now(), ...heal })
      resolvedCustomerId = customer.id
    }

    await b.update('bookings', bookingId, {
      status: 'consumed',
      consumedSessionId: sessionId,
    })
  })

  return { customerId: resolvedCustomerId }
}

/**
 * Credit the unused portion of a booking advance back to the customer's wallet.
 *
 * Used by PaymentSplitSheet when `prepaidAdvance > finalGrandTotal`. Writes a
 * WalletTransaction (type='credit', referenceType='booking_advance') and bumps
 * customer.walletBalance. Single flat tx (Pattern D7); MUST NOT be called from
 * inside another transaction.
 */
export async function creditBookingAdvanceRemainder(params: {
  customerId: string
  amount: number
  bookingId: string
}): Promise<void> {
  const { customerId, amount, bookingId } = params
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Remainder amount must be a positive integer.')
  }
  // Group B — wallet credit ledger INSERT + customer balance UPDATE, atomic.
  await syncedBatch(['customers', 'wallet_transactions'], async (b) => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('Customer not found.')
    const now = Date.now()
    const newBalance = customer.walletBalance + amount
    await b.insert('wallet_transactions', {
      id: crypto.randomUUID(),
      customerId,
      type: 'credit',
      amount,
      balanceAfter: newBalance,
      paymentMode: null,
      referenceType: 'booking_advance',
      referenceId: bookingId,
      notes: 'Unused booking advance credited to wallet',
      createdAt: now,
    } as WalletTransaction)
    await b.update('customers', customerId, {
      walletBalance: newBalance,
      lastVisitAt: now,
    })
  })
}

/**
 * Owner-side reconciliation after player cancels a confirmed booking.
 *
 * Triggered by BookingRealtimeBridge when it sees status flip
 * 'confirmed' → 'cancelled' on a booking_intents UPDATE event.
 *
 * Single flat tx (Pattern D7):
 *   1. Mark Dexie booking.status = 'cancelled' (idempotent — noop if already).
 *      Skipped if booking row never crossed to Dexie (e.g. cancel arrived
 *      before owner Dexie was hydrated — defensive, do nothing).
 *   2. Lookup-or-create customer by booking.playerPhone.
 *   3. Credit booking.advanceAmount as a wallet credit
 *      (referenceType='booking_advance', referenceId=bookingId).
 *
 * Idempotency: if booking.status is already 'cancelled' AND a credit row
 * with referenceId=bookingId already exists, the function is a noop. This
 * matters because realtime can replay an UPDATE event after a brief
 * disconnect.
 */
export async function reconcileCancelledBooking(bookingId: string): Promise<void> {
  // Group B — idempotent cancel reconcile: bookings UPDATE + customer
  // lookup-or-create + advance-refund wallet-credit INSERT, all atomic.
  await syncedBatch(['bookings', 'customers', 'wallet_transactions'], async (b) => {
    const booking = await db.bookings.get(bookingId)
    if (!booking) {
      // Booking never crossed to Dexie (cancel before confirm hydrated locally),
      // or got wiped by reset. Nothing to refund here — Supabase row is the
      // source of truth for the player; owner just won't see it locally.
      return
    }
    if (booking.status === 'cancelled') {
      // Already reconciled; check if the refund landed too. If a credit row
      // already exists with this bookingId, we're done.
      const existing = await db.walletTransactions
        .where('referenceType').equals('booking_advance')
        .and((t) => t.referenceId === bookingId && t.type === 'credit')
        .first()
      if (existing) return
    }
    // 1. Flip Dexie booking → cancelled
    if (booking.status !== 'cancelled') {
      await b.update('bookings', bookingId, { status: 'cancelled' })
    }
    // 2. Lookup-or-create customer by phone (#153: normalize to '+91' canonical
    // form; legacy bare-format rows stay reachable and get healed on touch)
    const canonicalPhone = toCustomerPhone(booking.playerPhone)
    const matches = await db.customers
      .where('phone').anyOf(phoneLookupCandidates(booking.playerPhone)).toArray()
    let customer = preferCanonicalPhone(matches, booking.playerPhone)
    if (!customer) {
      const now = Date.now()
      customer = {
        id: crypto.randomUUID(),
        phone: canonicalPhone,
        name: booking.playerName?.trim() || null,
        walkInCode: null,
        walletBalance: 0,
        createdAt: now,
        lastVisitAt: now,
      }
      await b.insert('customers', customer as Customer & { id: string })
    } else if (customer.phone !== canonicalPhone) {
      // Heal a legacy bare-format row (pre-#153) — safe: preferCanonicalPhone
      // only returns it when no canonical row exists, so no uniqueness clash.
      await b.update('customers', customer.id, { phone: canonicalPhone })
    }
    // 3. Credit the advance back as a wallet credit (refund)
    if (booking.advanceAmount > 0) {
      const now = Date.now()
      const newBalance = customer.walletBalance + booking.advanceAmount
      await b.insert('wallet_transactions', {
        id: crypto.randomUUID(),
        customerId: customer.id,
        type: 'credit',
        amount: booking.advanceAmount,
        balanceAfter: newBalance,
        paymentMode: null,
        referenceType: 'booking_advance',
        referenceId: bookingId,
        notes: 'Booking cancelled — advance refunded to wallet',
        createdAt: now,
      } as WalletTransaction)
      await b.update('customers', customer.id, {
        walletBalance: newBalance,
        lastVisitAt: now,
      })
    }
  })
}

/**
 * Sweep Dexie bookings for no-shows.
 *
 * A confirmed booking whose `slotEnd + 30 min` is in the past AND that was
 * never linked to a session is marked 'no_show'. No wallet credit (forfeit —
 * per skill cancellation-window policy).
 *
 * Idempotent. Safe to call on every app mount + every 4h alongside the coin
 * expiry sweep. Returns count of newly marked rows for telemetry.
 */
export async function applyNoShowSweep(now: number = Date.now()): Promise<number> {
  const NO_SHOW_GRACE_MS = 30 * 60_000
  // We can't push the time math into Dexie's index — slotEnd isn't indexed —
  // so we read all 'confirmed' rows and filter in JS. Tiny set (bookings are
  // ephemeral by design); negligible cost.
  const candidates = await db.bookings.where('status').equals('confirmed').toArray()
  const stale = candidates.filter(
    (b) => b.consumedSessionId === undefined && b.slotEnd + NO_SHOW_GRACE_MS < now,
  )
  if (stale.length === 0) return 0
  // Group B — mark each stale booking no_show; each gets its own outbox row.
  await syncedBatch(['bookings'], async (batch) => {
    for (const bk of stale) {
      await batch.update('bookings', bk.id, { status: 'no_show' })
    }
  })
  return stale.length
}
