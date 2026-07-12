// #129 — one-time backfill boot bridge. Mirrors SyncReaderBoot (Pattern A10).
//
// Runs backfillLocalRowsToSupabase() exactly once per app-load when the device
// is in a state where the enqueued rows can actually push:
//   1. dbReady   — per-user Dexie is open (else we'd scan the placeholder DB).
//   2. userId    — owner signed in. STABLE-IDENTITY gate (session?.user?.id),
//                  not the session object ref (Pattern A10 — else repeat auth
//                  events re-fire this).
//   3. claim present — the JWT carries user_club_id. WITHOUT it, pushOne throws
//                  NoUserClubIdClaimError and every enqueued row dead-letters
//                  after 10 attempts. jwtHasClubClaim() is the same lock-free
//                  gate seedIfEmpty (D4) uses. A claim-less legacy owner stays
//                  offline-only (sync is already off for them) — we don't
//                  enqueue, and the sentinel stays unset so it runs later once
//                  the hook is configured and a claim-bearing token mints.
//   4. !isPlayerHubRoute — `/c/*` / `/poster/*` never touch owner machinery.
//
// The backfill's own settings.backfillEnqueuedAt sentinel makes it idempotent
// across reloads; this component just decides WHEN it's safe to attempt.
//
// Returns null — pure side-effect component.

import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { backfillLocalRowsToSupabase } from '../db/backfillToSupabase'
import { jwtHasClubClaim } from '../db/syncClubId'

function isPlayerHubRoute(): boolean {
  if (typeof window === 'undefined') return false
  const p = window.location.pathname
  return p.startsWith('/c/') || p.startsWith('/poster/')
}

export function SyncBackfillBoot() {
  const { dbReady, session } = useAuthStore()
  // Pattern A10 — stable-identity gate (primitive, not the session object).
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (isPlayerHubRoute()) return
    if (!dbReady || !userId) return
    // Claim-gate: only enqueue when the push path can succeed. jwtHasClubClaim
    // is lock-free (never supabase.auth.*) — safe on the boot path.
    if (!jwtHasClubClaim()) return

    let cancelled = false
    void (async () => {
      try {
        const result = await backfillLocalRowsToSupabase()
        if (cancelled) return
        if (result.ran && result.enqueued > 0) {
          // eslint-disable-next-line no-console
          console.log(`[backfill] #129 enqueued ${result.enqueued} rows for upload`, result.perTable)
        }
      } catch (e) {
        // Non-fatal: a failure here just means the sentinel stays unset and the
        // next boot retries. The app is fully usable regardless.
        // eslint-disable-next-line no-console
        console.error('[backfill] #129 enqueue failed (will retry next boot):', e)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [dbReady, userId])

  return null
}
