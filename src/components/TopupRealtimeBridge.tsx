import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToastStore } from '../store/toastStore'
import {
  subscribeToTopupIntents,
  unsubscribeTopupIntents,
  type TopupInsertEvent,
} from '../lib/realtimeTopups'
import { getOwnerClub } from '../lib/playerHubApi'

// App-shell mount-once bridge that keeps the topup_intents realtime channel
// open for the entire authenticated session — not just while /wallet is
// mounted. Before this existed, a player tapping "I've paid" only updated
// the owner's badge if the owner happened to be sitting on /wallet. See #83
// follow-up comment for the full investigation.
//
// Design rules (see Pattern A8 in bug_patterns.md):
// - Gated on dbReady + session + subscriptionLoaded (so we never query before
//   auth + DB are ready) AND skipped on /c/ and /poster/ (Player Hub public
//   routes never boot owner auth — Pattern A7).
// - Tracks active userId via a ref so a second user signing in on the same
//   tab gets a fresh subscription (same trick as _clubSyncDoneForUser in
//   useLiveData.ts which fixed P3 / #53).
// - Tracks active clubId via a ref so the effect doesn't churn the channel
//   on unrelated re-renders.
// - On INSERT, increments the Zustand badge AND (when owner is not already
//   on /wallet) fires a toast with a "Review" action that navigates there.
//   This avoids silent badge changes that the owner can miss.

function isPlayerHubPath(pathname: string): boolean {
  return pathname.startsWith('/c/') || pathname.startsWith('/poster/')
}

export function TopupRealtimeBridge() {
  const { session, dbReady, subscriptionLoaded } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const show = useToastStore((s) => s.show)

  // Refs so the INSERT callback always sees the current pathname / navigate
  // without re-subscribing on every route change.
  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const showRef = useRef(show)
  showRef.current = show

  // Tracks the (userId, clubId) the channel is currently bound to.
  const activeUserIdRef = useRef<string | null>(null)
  const activeClubIdRef = useRef<string | null>(null)

  const userId = session?.user?.id ?? null

  // Track whether we're currently on a Player Hub public route. We DO NOT
  // include pathname in the effect deps below — that would tear down + rebuild
  // the channel on every navigation. Instead the effect re-runs only on the
  // auth-shape changes that actually require a re-subscription.
  const onPublicRoute = isPlayerHubPath(location.pathname)

  useEffect(() => {
    // Public Player Hub routes: never touch owner auth or realtime.
    if (onPublicRoute) return

    // Wait for auth + DB + subscription to settle.
    if (!dbReady || !userId || !subscriptionLoaded) return

    // If we already bound the channel for this user, nothing to do.
    // Different user on same tab → fall through to re-bind.
    if (activeUserIdRef.current === userId && activeClubIdRef.current !== null) return

    let cancelled = false

    function handleInsert(event: TopupInsertEvent) {
      // Owner is already on /wallet — the page handles its own UI, no toast.
      if (pathnameRef.current === '/wallet') return

      const who = event.playerName?.trim() || event.playerMobile
      showRef.current({
        message: `New top-up: ${who} — ₹${event.amount.toLocaleString('en-IN')}`,
        type: 'info',
        actionLabel: 'Review',
        onAction: () => navigateRef.current('/wallet'),
        durationMs: 6000,
      })
    }

    void (async () => {
      try {
        const club = await getOwnerClub()
        if (cancelled || !club) return
        await subscribeToTopupIntents(club.id, handleInsert)
        if (cancelled) {
          // Auth changed mid-flight — undo before storing refs.
          unsubscribeTopupIntents()
          return
        }
        activeUserIdRef.current = userId
        activeClubIdRef.current = club.id
      } catch {
        // Club may not exist yet (owner hasn't set up Player Hub). Silent —
        // subscribeToTopupIntents is the only side-effect and it never ran.
      }
    })()

    return () => {
      cancelled = true
      // Only tear down if THIS effect run is the one that owns the channel.
      // Two effect runs in StrictMode would otherwise unsubscribe the live
      // channel created by the second run.
      if (activeUserIdRef.current === userId) {
        unsubscribeTopupIntents()
        activeUserIdRef.current = null
        activeClubIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady, userId, subscriptionLoaded, onPublicRoute])

  return null
}
