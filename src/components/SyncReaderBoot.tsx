// Phase C Chunk 5.0 — owns the SyncReader lifecycle, mirroring SyncRunnerBoot.
//
// Mount-once bridge at the app shell (Pattern A8). Gated on:
//   1. dbReady — the per-user Dexie instance is open. Without this, reader
//      writes would target the placeholder DB.
//   2. userId  — owner is signed in. Extracted from session?.user?.id so the
//      effect is keyed on STABLE IDENTITY, not the session object reference.
//      Zustand set({session}) on the same account creates a new object each
//      call (e.g. INITIAL_SESSION delivering the same data as getSession
//      just returned); depending on the raw session ref would tear down and
//      re-start the reader on every one of those set() calls, doubling
//      cold-boot data cost. See Pattern A10 (TopupRealtimeBridge +
//      BookingRealtimeBridge follow the same rule).
//   3. !isPlayerHubRoute — `/c/*` and `/poster/*` are anon public surfaces
//      that must never touch owner auth or owner data. Same gate as
//      AuthInitializer / ExpirySweepRunner / SyncRunnerBoot.
//
// Returns null — pure side-effect component.

import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { syncReader } from '../db/syncReader'

// Local helper — duplicates the App.tsx-private check (same shape) so this
// component is self-contained. window-only read is safe because the
// component never renders during SSR.
function isPlayerHubRoute(): boolean {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname
  return p.startsWith('/c/') || p.startsWith('/poster/')
}

export function SyncReaderBoot() {
  const { dbReady, session } = useAuthStore()
  // Pattern A10 — stable-identity gate. Zustand delivers a new session
  // object reference on every set() even when the user id is unchanged;
  // useEffect below depends on userId (a primitive) so it re-fires only
  // when the actual user identity changes, not on repeat auth events for
  // the same account.
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !userId) return

    syncReader.start()
    return () => {
      syncReader.stop()
    }
  }, [dbReady, userId])

  return null
}
