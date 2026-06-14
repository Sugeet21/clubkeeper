import { startOfDay, endOfDay } from 'date-fns'
import { db } from './database'
import { calculateAmount, applyRounding } from '../lib/money'
import { validatePlayerName, validateItemName, validateCanteenItemName } from '../lib/validation'
import { seedIfEmpty } from './seed'
import { normalizeName, findMatchingCanteenItem } from '../lib/canteenMatch'
import { coinsEarnedForTopup, resolveCoinConfig } from '../lib/coins'
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

/**
 * Current Dexie schema version. Mirror of `this.version(N)` in `database.ts`.
 * Used by export/import to gate forward-compatibility. Bump when database.ts bumps.
 */
export const CURRENT_SCHEMA_VERSION = 16

export interface ClubKeeperBackupV16 {
  schemaVersion: 16
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
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export async function getAllTables(): Promise<GameTable[]> {
  return db.gameTables.orderBy('sortOrder').toArray()
}

export async function getTableById(id: number): Promise<GameTable | undefined> {
  return db.gameTables.get(id)
}

export async function addTable(data: Omit<GameTable, 'id'>): Promise<number> {
  return db.gameTables.add(data)
}

export async function updateTable(
  id: number,
  data: Partial<Omit<GameTable, 'id'>>,
): Promise<void> {
  await db.gameTables.update(id, data)
}

export async function deleteTable(id: number): Promise<void> {
  await db.gameTables.delete(id)
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function getActiveSessionForTable(
  tableId: number,
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

export async function getSessionById(id: number): Promise<Session | undefined> {
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
): Promise<number> {
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

  return db.sessions.add({
    ...data,
    startedAt,
    endedAt: null,
    pausedTotalMs: 0,
    pausedAt: null,
    status: 'running',
    amount: 0,
    ...alarmFields,
    ...rateCardFields,
  })
}

export async function acknowledgeNotify(sessionId: number): Promise<void> {
  await db.sessions.update(sessionId, { notifyAcknowledgedAt: Date.now() })
}

export async function snoozeNotify(sessionId: number, snoozeMs: number): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) return
  const original = session.notifyAtMs ?? Date.now()
  const candidate = original + snoozeMs
  // Anchor to original fire time so "snooze 15 min" means exactly 15 min from fire,
  // not 15 min from when the user tapped (Pattern T6). Fall back to now + snoozeMs
  // if user took so long that the anchored time is already in the past.
  const newNotifyAt = candidate > Date.now() ? candidate : Date.now() + snoozeMs
  await db.sessions.update(sessionId, {
    notifyAtMs: newNotifyAt,
    notifyAcknowledgedAt: null,
  })
}

/**
 * Set or replace alarm on an existing (running or paused) session.
 * notifyAfterMs = duration FROM NOW. Pass null to clear the alarm entirely.
 */
export async function updateSessionNotify(
  sessionId: number,
  notifyAfterMs: number | null,
): Promise<void> {
  if (notifyAfterMs === null) {
    await db.sessions.update(sessionId, {
      notifyAtMs: null,
      notifyAcknowledgedAt: null,
    })
    return
  }
  await db.sessions.update(sessionId, {
    notifyAtMs: Date.now() + notifyAfterMs,
    notifyAcknowledgedAt: null,
  })
}

export async function pauseSession(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'running') return

  await db.sessions.update(sessionId, {
    status: 'paused',
    pausedAt: Date.now(),
  })
}

export async function resumeSession(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'paused' || session.pausedAt === null) return

  const delta = Date.now() - session.pausedAt
  await db.sessions.update(sessionId, {
    status: 'running',
    pausedTotalMs: session.pausedTotalMs + delta,
    pausedAt: null,
  })
}

export async function stopSession(sessionId: number): Promise<Session> {
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

  await db.sessions.update(sessionId, {
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
  sessionId: number,
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
  const sessionItems = await db.sessionItems.where('sessionId').equals(sessionId).toArray()
  const itemsTotal = sessionItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const grandTotal = tableAmt + itemsTotal

  await db.sessions.update(sessionId, {
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
  sessionId: number,
  breakdown: { cash: number; upi: number; wallet: number },
  customerId?: string,
): Promise<void> {
  if (typeof sessionId !== 'number' || !Number.isFinite(sessionId) || sessionId <= 0) {
    throw new Error(`confirmPaymentAndStop: invalid sessionId (got ${typeof sessionId} ${String(sessionId)})`)
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

  await db.transaction(
    'rw',
    db.sessions,
    db.sessionItems,
    db.customers,
    db.walletTransactions,
    db.settings,
    async () => {
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
      const settings = await db.settings.get(1)
      const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
      let billableMs = rawElapsedMs
      let roundedDurationMs: number | undefined
      if (!isRateCard && session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
        roundedDurationMs = applyRounding(rawElapsedMs, settings.rounding)
        billableMs = roundedDurationMs
      }
      const amount = calculateAmount(session, billableMs, settings?.rounding ?? 'none')

      const sessionItems = await db.sessionItems.where('sessionId').equals(sessionId).toArray()
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
        await db.walletTransactions.add({
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
        })
        await db.customers.update(customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      await db.sessions.update(sessionId, {
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
export async function cancelPaymentAndResume(sessionId: number): Promise<void> {
  const session = await db.sessions.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (!session.paymentInProgress || session.pausedAt === null) return

  const delta = Date.now() - session.pausedAt
  await db.sessions.update(sessionId, {
    status: 'running',
    pausedTotalMs: session.pausedTotalMs + delta,
    pausedAt: null,
    paymentInProgress: false,
  })
}

export async function editSessionStart(
  sessionId: number,
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

  await db.sessions.update(sessionId, { startedAt: newStartedAt })
}

export async function getTodaysSessions(): Promise<Session[]> {
  const now = new Date()
  const start = startOfDay(now).getTime()
  const end = endOfDay(now).getTime()
  return db.sessions
    .where('startedAt')
    .between(start, end, true, true)
    .toArray()
}

export async function getSessionsBetween(
  start: number,
  end: number,
): Promise<Session[]> {
  return db.sessions
    .where('startedAt')
    .between(start, end, true, true)
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
  id: number,
  data: Partial<Omit<Session, 'id'>>,
): Promise<void> {
  await db.sessions.update(id, data)
}

// ─── Bulk data operations ─────────────────────────────────────────────────────

export async function clearAllSessions(): Promise<void> {
  await db.sessions.clear()
}

export async function resetEverything(): Promise<void> {
  await db.gameTables.clear()
  await db.sessions.clear()
  await db.settings.clear()
  await seedIfEmpty()
}

export async function getAllDataForExport(): Promise<ClubKeeperBackupV16> {
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
  ])
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
): Promise<number> {
  const nameError = validateItemName(data.name)
  if (nameError) throw new Error(nameError)
  if (!Number.isInteger(data.price) || data.price < 0 || data.price > 99999) {
    throw new Error('Price must be 0–99999')
  }
  if (!Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 99) {
    throw new Error('Quantity must be 1–99')
  }
  return db.sessionItems.add({
    ...data,
    name: data.name.trim(),
    addedAt: Date.now(),
  })
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
  id: number,
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
  await db.transaction('rw', db.sessionItems, db.canteenItems, async () => {
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
        await db.canteenItems.update(matched.id, { currentStock: newStock })
      }
    }

    await db.sessionItems.update(id, patch)
  })
}

export async function deleteSessionItem(id: number): Promise<void> {
  await db.transaction('rw', db.sessionItems, db.canteenItems, async () => {
    const existing = await db.sessionItems.get(id)
    if (!existing) return // idempotent — already gone

    const matched = await findMatchingCanteenItemForRow(existing.name, existing.price)
    if (matched && matched.stockEnabled === true && matched.id !== undefined) {
      const currentStock = matched.currentStock ?? 0
      await db.canteenItems.update(matched.id, {
        currentStock: currentStock + existing.quantity,
      })
    }

    await db.sessionItems.delete(id)
  })
}

export async function restoreSessionItem(item: SessionItem): Promise<void> {
  await db.transaction('rw', db.sessionItems, db.canteenItems, async () => {
    const matched = await findMatchingCanteenItemForRow(item.name, item.price)
    if (matched && matched.stockEnabled === true && matched.id !== undefined) {
      const currentStock = matched.currentStock ?? 0
      const newStock = currentStock - item.quantity
      if (newStock < 0) {
        throw new InsufficientStockError(currentStock, matched.name)
      }
      await db.canteenItems.update(matched.id, { currentStock: newStock })
    }
    // Use add() not restore-by-id — Dexie autoincrement doesn't reuse ids
    await db.sessionItems.add({
      sessionId: item.sessionId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      addedAt: item.addedAt, // preserve original timestamp for Undo semantics
    })
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
  sessionId: number
  name: string
  price: number
  quantity: number
}): Promise<number> {
  const { sessionId, name, price, quantity } = input
  const normalized = normalizeName(name)

  return db.transaction('rw', db.sessionItems, async () => {
    const existing = await db.sessionItems
      .where('sessionId')
      .equals(sessionId)
      .filter(item => normalizeName(item.name) === normalized && item.price === price)
      .first()

    if (existing && existing.id != null) {
      const newQty = Math.min(99, existing.quantity + quantity)
      await db.sessionItems.update(existing.id, { quantity: newQty })
      return existing.id
    }

    return db.sessionItems.add({
      sessionId,
      name: name.trim(),
      price,
      quantity,
      addedAt: Date.now(),
    })
  })
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
): Promise<number> {
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

  return db.canteenItems.add({
    name: trimmedName,
    defaultPrice: input.defaultPrice,
    stockEnabled,
    currentStock,
    isActive: true,
    createdAt: Date.now(),
    sortOrder,
  })
}

export async function updateCanteenItem(
  id: number,
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

  await db.canteenItems.update(id, { ...patch, currentStock })
}

export async function softDeleteCanteenItem(id: number): Promise<void> {
  await db.canteenItems.update(id, { isActive: false })
}

export async function decrementCanteenItemStock(
  id: number,
  quantity: number,
): Promise<{ oldStock: number; newStock: number }> {
  return db.transaction('rw', db.canteenItems, async () => {
    const item = await db.canteenItems.get(id)
    if (!item) throw new Error(`Canteen item ${id} not found`)
    if (!item.stockEnabled) throw new Error('Stock not tracked on this item')
    const oldStock = item.currentStock!
    if (oldStock < quantity) throw new Error('Insufficient stock')
    const newStock = oldStock - quantity
    await db.canteenItems.update(id, { currentStock: newStock })
    return { oldStock, newStock }
  })
}

export async function getLowStockThreshold(): Promise<number> {
  const settings = await db.settings.get(1)
  return settings?.lowStockThreshold ?? 5
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
  tableId: number
  startedAt: number       // Unix ms (past)
  endedAt: number         // Unix ms (> startedAt and ≤ Date.now())
  playerName: string | null
  playerCount: number     // 1–20
  note: string | null
  items?: BackEntryItemInput[]  // optional; defaults to []
}

export async function createBackEntry(input: BackEntryInput): Promise<number> {
  const items = input.items ?? []

  // Pattern D7 — ONE flat transaction. All writes atomic — session + sessionItems + stock.
  return db.transaction('rw', db.sessions, db.gameTables, db.settings, db.canteenItems, db.sessionItems, async () => {
    // ---- 1. Validate table ----
    const table = await db.gameTables.get(input.tableId)
    if (!table) throw new Error('Table not found')
    if (table.outOfService) throw new Error('Table is out of service')

    // ---- 2. Overlap check (unchanged) ----
    // Two intervals [a,b] and [c,d] overlap iff a < d AND c < b.
    // For active rows (running/paused) treat the open end as Date.now().
    const candidates = await db.sessions.where('tableId').equals(input.tableId).toArray()
    const conflict = candidates.find((s) => {
      const sEnd = s.status === 'completed' ? (s.endedAt ?? 0) : Date.now()
      return s.startedAt < input.endedAt && input.startedAt < sEnd
    })
    if (conflict) throw new BackEntryOverlapError(conflict)

    // ---- 3. Build & insert the session row ----
    const settings = await db.settings.get(1)
    const rounding = settings?.rounding ?? 'none'

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

    const sessionId = (await db.sessions.add(proto)) as number

    // ---- 4. Process items INLINE (Pattern D7 — no calls to addSessionItem /
    //         addOrIncrementSessionItem / decrementCanteenItemStock from inside this tx) ----
    if (items.length > 0) {
      // Load all active canteen items once — use .filter not .where('isActive').equals(1) (Pattern D9)
      const activeCanteen = (await db.canteenItems.toArray()).filter((c) => c.isActive === true)

      // Aggregate stock needs by canteenItem.id so multiple rows for the same item
      // do not each independently pass a single insufficient-stock check.
      const stockNeeded = new Map<number, number>() // canteenItemId → totalQty needed

      // First pass: match items and build the stock-needs map.
      const resolved: Array<{ item: BackEntryItemInput; canteenId?: number }> = []
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
        await db.canteenItems.update(canteenId, {
          currentStock: (live.currentStock ?? 0) - totalQty,
        })
      }

      // Insert sessionItems rows. addedAt anchored to endedAt - order*1000 so items
      // fall inside the session's time window (no "future" timestamps relative to session).
      let order = 0
      for (const r of resolved) {
        await db.sessionItems.add({
          sessionId,
          name: r.item.name.trim(),
          price: r.item.price,
          quantity: r.item.quantity,
          addedAt: input.endedAt - order * 1000,
        })
        order += 1
      }
    }

    return sessionId
  })
}

export async function moveSessionToTable(
  sessionId: number,
  toTableId: number,
): Promise<void> {
  await db.transaction('rw', db.sessions, db.gameTables, async () => {
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

    await db.sessions.update(sessionId, {
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
  sessionId: number,
  breakdown: { cash: number; upi: number; wallet: number },
  customerId?: string,
): Promise<void> {
  // Defense-in-depth: TypeScript's `sessionId: number` cannot prevent a string
  // sneaking in via untyped JS or route param leakage. db.sessions.get('2')
  // silently returns undefined (autoincrement keys are numbers), which causes
  // session.amount to read as 0 downstream — exact bug shipped in Phase 2.
  if (typeof sessionId !== 'number' || !Number.isFinite(sessionId) || sessionId <= 0) {
    throw new Error(`recordSessionPaymentBreakdown: invalid sessionId (got ${typeof sessionId} ${String(sessionId)})`)
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

  await db.transaction(
    'rw',
    db.sessions,
    db.sessionItems,
    db.customers,
    db.walletTransactions,
    async () => {
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
        await db.walletTransactions.add({
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
        })
        await db.customers.update(customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      await db.sessions.update(sessionId, {
        paymentBreakdown: { cash, upi, wallet },
      })
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
  canteenItemId: number
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
    if (!Number.isInteger(line.canteenItemId) || line.canteenItemId <= 0) {
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
  const qtyByItem = new Map<number, number>()
  for (const line of input.items) {
    qtyByItem.set(
      line.canteenItemId,
      (qtyByItem.get(line.canteenItemId) ?? 0) + line.quantity,
    )
  }

  const saleId = crypto.randomUUID()
  const now = Date.now()

  await db.transaction(
    'rw',
    db.canteenSales,
    db.canteenItems,
    db.customers,
    db.walletTransactions,
    async () => {
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
          await db.canteenItems.update(itemId, { currentStock: newStock })
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
        await db.walletTransactions.add({
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
        })
        await db.customers.update(customer.id, {
          walletBalance: newBalance,
          lastVisitAt: now,
        })
      }

      // Insert the sale row last so any earlier throw rolls everything back.
      await db.canteenSales.add({
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
      })
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
    (s) => s.status === 'completed' && s.paymentBreakdown !== undefined,
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
        (s) => s.status === 'completed' && s.paymentBreakdown !== undefined,
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
  canteenItemId: number
  quantityAdded: number
  cost: number
  source: 'piggy' | 'other'
  notes?: string
}): Promise<string> {
  if (!Number.isInteger(input.canteenItemId) || input.canteenItemId <= 0) {
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

  await db.transaction('rw', db.stockPurchases, db.canteenItems, async () => {
    const item = await db.canteenItems.get(input.canteenItemId)
    if (!item) throw new StockPurchaseInvalidError('Canteen item not found.')

    await db.stockPurchases.add({
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
    })

    // Stock tracking is optional per item — only mutate when enabled.
    if (item.stockEnabled === true) {
      const oldStock = item.currentStock ?? 0
      await db.canteenItems.update(input.canteenItemId, {
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

  await db.transaction('rw', db.customers, db.walletTransactions, async () => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('customer_not_found')

    // Re-check idempotency guard inside tx in case of concurrent calls
    const alreadyHadFirstTopup = !!customer.firstTopupAt
    const effectiveWelcomeCoins = alreadyHadFirstTopup ? 0 : welcomeCoins

    const totalCoins = tierCoins + effectiveWelcomeCoins
    const newWalletBalance = customer.walletBalance + rupees
    const now = Date.now()

    // Running coin balance tally (each row records balance AFTER that row)
    let runningCoinBalance = customer.coinBalance ?? 0

    // 1. Wallet credit row
    await db.walletTransactions.add({
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
    })

    // 2. Tier coin credit row
    if (tierCoins > 0) {
      runningCoinBalance += tierCoins
      await db.walletTransactions.add({
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
      })
    }

    // 3. Welcome bonus row (first-topup, one-shot)
    if (effectiveWelcomeCoins > 0) {
      runningCoinBalance += effectiveWelcomeCoins
      await db.walletTransactions.add({
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
      })
    }

    await db.customers.update(customerId, {
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

  await db.transaction('rw', db.customers, db.walletTransactions, async () => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('customer_not_found')

    const currentCoins = customer.coinBalance ?? 0
    if (currentCoins < coins) throw new InsufficientCoinsError(currentCoins, coins)

    const newCoinBalance = currentCoins - coins

    await db.walletTransactions.add({
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
    })

    await db.customers.update(customerId, {
      coinBalance: newCoinBalance,
      lastVisitAt: Date.now(),
    })
  })
}
