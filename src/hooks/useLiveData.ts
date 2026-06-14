import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { startOfDay, endOfDay } from 'date-fns'
import { db } from '../db/database'
import { getRecentItems, type RecentItem } from '../db/queries'
import { useAuthStore } from '../store/authStore'
import { getOwnerClub } from '../lib/playerHubApi'
import type { GameTable, Session, ClubSettings, SessionItem } from '../types'

// ─── Club sync: Supabase → Dexie ─────────────────────────────────────────────
// Runs once per browser session. Ensures slug and cloud-mirrored fields in
// Dexie match Supabase, fixing the cross-device desync bug where a fresh
// device has no local settings yet.

// Keyed by userId so a second user signing in on the same tab gets their own sync.
let _clubSyncDoneForUser: string | null = null

export function useSyncClubFromSupabase() {
  const { dbReady, session } = useAuthStore()
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!dbReady || !userId || _clubSyncDoneForUser === userId) return
    _clubSyncDoneForUser = userId

    getOwnerClub()
      .then(async (club) => {
        if (!club) return
        const local = await db.settings.get(1)
        // slug + slugLocked: always mirror from Supabase (source of truth).
        // acceptsTopups / coinsEnabled / coinTiers: only fill in when Dexie
        // has no value yet (undefined). If the owner toggled these on THIS
        // device, Dexie already has a value — don't race-overwrite it.
        await db.settings.update(1, {
          slug: club.slug,
          slugLocked: true,
          ...(local?.acceptsTopups === undefined ? { acceptsTopups: club.acceptsTopups } : {}),
          ...(local?.coinsEnabled === undefined ? { coinsEnabled: club.coinsEnabled } : {}),
          ...(club.coinTiers.length > 0 && !local?.coinTiers?.length
            ? { coinTiers: club.coinTiers }
            : {}),
        })
      })
      .catch(() => {
        // Network failure — leave Dexie as-is; will retry on next mount.
        _clubSyncDoneForUser = null
      })
  }, [dbReady, userId])
}

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
