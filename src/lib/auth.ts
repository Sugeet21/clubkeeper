// Phase C Chunk 1 — Owner auth wrapper.
//
// This module is a THIN layer over `useAuthStore` (the existing Zustand store)
// and `getOwnerClub` (the existing playerHubApi reader). It exists so Phase C
// sync code has one stable hook to consume: `useCurrentUser()` returns the
// `{ user, clubId, status }` triple that SyncRunner + SyncReader + the sync
// indicator all need.
//
// Staff login is NOT in scope here (Phase D). The only "role" recognized is
// the implicit "user has a clubs.owner_id row matching them" = owner.
//
// `signInWithGoogle` + `signOut` are re-exported from authStore so Chunk 1+
// consumers don't have to import the store directly.

import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { getOwnerClub } from './playerHubApi'

export type CurrentUserStatus =
  | 'loading'      // initial mount, or in-flight auth/club fetch
  | 'signed_out'   // no Supabase session
  | 'signed_in'    // signed in, clubs.owner_id row found
  | 'no_club'      // signed in, NO clubs row matches — needs provisioning

export interface CurrentUserState {
  /** The Supabase auth user, or null when signed-out / loading. */
  user: ReturnType<typeof useAuthStore.getState>['user']
  /** Resolved Supabase clubs.id (UUID) for the signed-in owner, or null. */
  clubId: string | null
  /** Composite status — UI gates render branches on this. */
  status: CurrentUserStatus
}

/**
 * Phase C consumer hook. One source of truth for "who is the owner, what's
 * their club id, and is the auth/club info ready yet?" Wraps useAuthStore +
 * getOwnerClub. Re-runs the club fetch when the user id changes.
 *
 * NOTE: not memoized across components — each caller does its own
 * getOwnerClub() lookup. The owner's clubs row changes very rarely; if this
 * becomes a hot path in Phase C+, move the club fetch into authStore itself
 * so it lives alongside `profile` / `subscription`.
 */
export function useCurrentUser(): CurrentUserState {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)

  const [clubId, setClubId] = useState<string | null>(null)
  const [clubFetched, setClubFetched] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!user) {
      setClubId(null)
      setClubFetched(false)
      return
    }
    setClubFetched(false)
    getOwnerClub()
      .then((club) => {
        if (cancelled) return
        setClubId(club?.id ?? null)
        setClubFetched(true)
      })
      .catch(() => {
        if (cancelled) return
        // RLS or network error — treat as no_club so the UI surfaces the
        // "contact Sugeet" branch rather than spinning indefinitely. The
        // sync indicator (Chunk 6) will surface the underlying error.
        setClubId(null)
        setClubFetched(true)
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  let status: CurrentUserStatus
  if (loading) {
    status = 'loading'
  } else if (!user) {
    status = 'signed_out'
  } else if (!clubFetched) {
    status = 'loading'
  } else if (clubId) {
    status = 'signed_in'
  } else {
    status = 'no_club'
  }

  return { user, clubId, status }
}

// ─── Re-exports (so Chunk 3+ doesn't reach into the store directly) ──────────

export const signInWithGoogle = () => useAuthStore.getState().signInWithGoogle()
export const signOut = () => useAuthStore.getState().signOut()
