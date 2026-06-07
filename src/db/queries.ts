import { startOfDay, endOfDay } from 'date-fns'
import { db } from './database'
import { calculateAmount, applyRounding } from '../lib/money'
import { validatePlayerName, validateItemName, validateCanteenItemName } from '../lib/validation'
import { seedIfEmpty } from './seed'
import type { GameTable, Session, ClubSettings, SessionItem, CanteenItem } from '../types'

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
  return db.sessions.add({
    ...data,
    startedAt,
    endedAt: null,
    pausedTotalMs: 0,
    pausedAt: null,
    status: 'running',
    amount: 0,
    ...alarmFields,
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

  // Apply time rounding (per-hour sessions only)
  const settings = await db.settings.get(1)
  let billableMs = rawElapsedMs
  let roundedDurationMs: number | undefined

  if (session.billingMode === 'per_hour' && settings && settings.rounding !== 'none') {
    roundedDurationMs = applyRounding(rawElapsedMs, settings.rounding)
    billableMs = roundedDurationMs
  }

  const amount = calculateAmount(
    session.billingMode,
    billableMs,
    session.rateSnapshot,
    session.framesPlayed,
  )

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

export async function getAllDataForExport(): Promise<{
  tables: GameTable[]
  sessions: Session[]
  settings: ClubSettings | undefined
}> {
  const [tables, sessions, settings] = await Promise.all([
    db.gameTables.toArray(),
    db.sessions.toArray(),
    db.settings.get(1),
  ])
  return { tables, sessions, settings }
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
  await db.sessionItems.update(id, patch)
}

export async function deleteSessionItem(id: number): Promise<void> {
  await db.sessionItems.delete(id)
}

export async function restoreSessionItem(item: SessionItem): Promise<number> {
  // for Undo after delete — preserves original addedAt
  return db.sessionItems.add(item)
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
