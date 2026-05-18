import { useLiveQuery } from 'dexie-react-hooks'
import { startOfDay, endOfDay } from 'date-fns'
import { db } from '../db/database'
import type { GameTable, Session, ClubSettings } from '../types'

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
