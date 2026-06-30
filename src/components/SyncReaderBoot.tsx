// Phase C Chunk 5.0 — owns the SyncReader lifecycle, mirroring SyncRunnerBoot.
//
// Mount-once bridge at the app shell (Pattern A8). Gated on:
//   1. dbReady — the per-user Dexie instance is open. Without this, reader
//      writes would target the placeholder DB.
//   2. session  — owner is signed in. No session = no club_id to scope to.
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

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !session) return

    syncReader.start()
    return () => {
      syncReader.stop()
    }
  }, [dbReady, session])

  return null
}
