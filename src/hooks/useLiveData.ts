import { useLiveQuery } from 'dexie-react-hooks'
import { startOfDay, endOfDay } from 'date-fns'
import { db } from '../db/database'
import { getRecentItems, type RecentItem } from '../db/queries'
import type { GameTable, Session, ClubSettings, SessionItem } from '../types'

export type SessionWithItems = { session: Session; items: SessionItem[] }

export function useTables(): GameTable[] {
  return useLiveQuery(() => db.gameTables.orderBy('sortOrder').toArray(), []) ?? []
}

export function useActiveSessions(): Session[] {
  return (
    useLiveQuery(
      () => db.sessions.where('status').anyOf(['running', 'paused']).toArray(),
      [],
    ) ?? []
  )
}

export function useTodaysSessions(): Session[] {
  return (
    useLiveQuery(() => {
      const start = startOfDay(new Date()).getTime()
      const end = endOfDay(new Date()).getTime()
      return db.sessions.where('startedAt').between(start, end, true, true).toArray()
    }, []) ?? []
  )
}

export function useSession(id: number | undefined): Session | undefined {
  return useLiveQuery(
    () => (id !== undefined ? db.sessions.get(id) : undefined),
    [id],
  )
}

export function useSessionsBetween(start: number, end: number): Session[] {
  return (
    useLiveQuery(
      () => db.sessions.where('startedAt').between(start, end, true, true).toArray(),
      [start, end],
    ) ?? []
  )
}

export function useSessionsForDate(date: Date): Session[] {
  const start = startOfDay(date).getTime()
  const end = endOfDay(date).getTime()
  return (
    useLiveQuery(
      () => db.sessions.where('startedAt').between(start, end, true, true).toArray(),
      [start, end],
    ) ?? []
  )
}

export function useTable(id: number | undefined): GameTable | undefined {
  return useLiveQuery(
    () => (id !== undefined ? db.gameTables.get(id) : undefined),
    [id],
  )
}

export function useSettings(): ClubSettings | undefined {
  return useLiveQuery(() => db.settings.get(1), [])
}

/** Returns sessions in a time range, each with their items array. Single live query — no N+1. */
export function useSessionsInRange(startMs: number, endMs: number): SessionWithItems[] {
  return (
    useLiveQuery(async () => {
      const sessions = await db.sessions
        .where('startedAt')
        .between(startMs, endMs, true, true)
        .toArray()
      const sessionIds = sessions.map((s) => s.id!).filter(Boolean)
      const allItems = sessionIds.length
        ? await db.sessionItems.where('sessionId').anyOf(sessionIds).toArray()
        : []
      const itemsBySessionId = new Map<number, SessionItem[]>()
      for (const item of allItems) {
        const list = itemsBySessionId.get(item.sessionId) ?? []
        list.push(item)
        itemsBySessionId.set(item.sessionId, list)
      }
      return sessions.map((s) => ({
        session: s,
        items: itemsBySessionId.get(s.id!) ?? [],
      }))
    }, [startMs, endMs], [] as SessionWithItems[]) ?? []
  )
}

export function useSessionItems(sessionId: number | undefined): SessionItem[] {
  return (
    useLiveQuery(
      () =>
        sessionId === undefined
          ? Promise.resolve([] as SessionItem[])
          : db.sessionItems.where('sessionId').equals(sessionId).sortBy('addedAt'),
      [sessionId],
      [] as SessionItem[],
    ) ?? []
  )
}

export function useRecentItems(limit = 8): RecentItem[] {
  return (
    useLiveQuery(
      () => getRecentItems(limit),
      [limit],
      [] as RecentItem[],
    ) ?? []
  )
}
