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

/** Sign-out hook — clears the per-user sync sentinel so the next sign-in
 *  (same user or different) re-pulls owner club data from Supabase.
 *  Without this, signing out and signing back in as the SAME user skips
 *  the Supabase→Dexie club sync (the userId guard matches the prior session).
 *  Same class of bug as syncClubId's per-token cache (Pattern S16). */
export function _resetClubSyncSentinel(): void {
  _clubSyncDoneForUser = null
}

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

// #162 — all list/range session readers exclude reversed (soft-deleted)
// sessions: a tombstone (deletedAt set) must vanish from Home, History,
// Summary and every aggregate, exactly like session_items do (#124). Only
// `useSession(id)` (single get, below) deliberately still returns a reversed
// row so SessionDetail can DISPLAY it with its audit trail.
export function useActiveSessions(): Session[] {
  return (
    useLiveQuery(
      () =>
        db.sessions
          .where('status')
          .anyOf(['running', 'paused'])
          .filter((s) => !s.deletedAt)
          .toArray(),
      [],
    ) ?? []
  )
}

export function useTodaysSessions(): Session[] {
  return (
    useLiveQuery(() => {
      const start = startOfDay(new Date()).getTime()
      const end = endOfDay(new Date()).getTime()
      return db.sessions
        .where('startedAt')
        .between(start, end, true, true)
        .filter((s) => !s.deletedAt)
        .toArray()
    }, []) ?? []
  )
}

export function useSession(id: string | undefined): Session | undefined {
  return useLiveQuery(
    () => (id !== undefined ? db.sessions.get(id) : undefined),
    [id],
  )
}

export function useSessionsBetween(start: number, end: number): Session[] {
  return (
    useLiveQuery(
      () =>
        db.sessions
          .where('startedAt')
          .between(start, end, true, true)
          .filter((s) => !s.deletedAt)
          .toArray(),
      [start, end],
    ) ?? []
  )
}

export function useSessionsForDate(date: Date): Session[] {
  const start = startOfDay(date).getTime()
  const end = endOfDay(date).getTime()
  return (
    useLiveQuery(
      () =>
        db.sessions
          .where('startedAt')
          .between(start, end, true, true)
          .filter((s) => !s.deletedAt)
          .toArray(),
      [start, end],
    ) ?? []
  )
}

export function useTable(id: string | undefined): GameTable | undefined {
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
        .filter((s) => !s.deletedAt) // #162 — exclude reversed sessions
        .toArray()
      const sessionIds = sessions.map((s) => s.id!).filter(Boolean)
      const allItems = sessionIds.length
        ? await db.sessionItems
            .where('sessionId')
            .anyOf(sessionIds)
            .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
            .toArray()
        : []
      const itemsBySessionId = new Map<string, SessionItem[]>() // Pattern R5: sessionId is a UUID string
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

export function useSessionItems(sessionId: string | undefined): SessionItem[] {
  return (
    useLiveQuery(
      () =>
        sessionId === undefined
          ? Promise.resolve([] as SessionItem[])
          : db.sessionItems
              .where('sessionId')
              .equals(sessionId)
              .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
              .sortBy('addedAt'),
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
