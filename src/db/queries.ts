import { startOfDay, endOfDay } from 'date-fns'
import { db } from './database'
import { calculateAmount, applyRounding } from '../lib/money'
import { validatePlayerName } from '../lib/validation'
import { seedIfEmpty } from './seed'
import type { GameTable, Session, ClubSettings } from '../types'

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
): Promise<number> {
  return db.sessions.add({
    ...data,
    startedAt: Date.now(),
    endedAt: null,
    pausedTotalMs: 0,
    pausedAt: null,
    status: 'running',
    amount: 0,
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
