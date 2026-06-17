import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToastStore } from '../store/toastStore'
import {
  subscribeToBookingIntents,
  unsubscribeBookingIntents,
  type BookingInsertEvent,
  type BookingUpdateEvent,
} from '../lib/realtimeBookings'
import { getOwnerClub } from '../lib/playerHubApi'
import { reconcileCancelledBooking } from '../db/queries'

// Sibling of TopupRealtimeBridge — keeps the booking_intents realtime channel
// open for the entire authenticated session. Same Pattern A6/A7/A8 guards:
//   - Skipped on /c/ and /poster/ (public Player Hub paths must never boot owner auth)
//   - Gated on dbReady + session + subscriptionLoaded
//   - Tracks active userId via ref so a second user signing in on the same tab
//     gets a fresh subscription
//   - Tracks active clubId via ref so unrelated re-renders don't churn the channel
//   - Re-fires a toast (unless owner is already on /bookings) so the badge change
//     doesn't go unnoticed
//
// Mounts in App.tsx alongside TopupRealtimeBridge.

function isPlayerHubPath(pathname: string): boolean {
  return pathname.startsWith('/c/') || pathname.startsWith('/poster/')
}

export function BookingRealtimeBridge() {
  const { session, dbReady, subscriptionLoaded } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const show = useToastStore((s) => s.show)

  const pathnameRef = useRef(location.pathname)
  pathnameRef.current = location.pathname
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const showRef = useRef(show)
  showRef.current = show

  const activeUserIdRef = useRef<string | null>(null)
  const activeClubIdRef = useRef<string | null>(null)

  const userId = session?.user?.id ?? null
  const onPublicRoute = isPlayerHubPath(location.pathname)

  useEffect(() => {
    if (onPublicRoute) return
    if (!dbReady || !userId || !subscriptionLoaded) return
    if (activeUserIdRef.current === userId && activeClubIdRef.current !== null) return

    let cancelled = false

    function handleUpdate(event: BookingUpdateEvent) {
      // P1e-2: player cancelled a confirmed booking. Reconcile owner-side —
      // flip Dexie status + credit advance refund to wallet. Fire-and-forget
      // with explicit catch; reconcile is idempotent so a duplicate event
      // from realtime replay is safe.
      if (event.oldStatus === 'confirmed' && event.newStatus === 'cancelled') {
        void reconcileCancelledBooking(event.intentId)
          .then(() => {
            // Toast unless owner is on /bookings (they'll see the badge change live).
            if (pathnameRef.current === '/bookings') return
            showRef.current({
              message: 'Booking cancelled — advance refunded to wallet',
              type: 'info',
              actionLabel: 'View',
              onAction: () => navigateRef.current('/bookings'),
              durationMs: 6000,
            })
          })
          .catch((e: unknown) => {
            // Non-critical — surfacing as a quiet warn keeps the bridge running.
            console.warn('[booking] reconcile failed:', e)
          })
      }
    }

    function handleInsert(event: BookingInsertEvent) {
      // If the owner is already on /bookings they see the live list — no toast.
      if (pathnameRef.current === '/bookings') return
      const who = event.playerName?.trim() || event.playerPhone
      const slot = new Date(event.slotStart)
      const time = slot.toLocaleString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      showRef.current({
        message: `New booking: ${who} — ${event.tableName} ${time}`,
        type: 'info',
        actionLabel: 'Review',
        onAction: () => navigateRef.current('/bookings'),
        durationMs: 6000,
      })
    }

    void (async () => {
      try {
        const club = await getOwnerClub()
        if (cancelled || !club) return
        // Only subscribe when the owner has opted in to bookings. Otherwise we
        // burn a realtime slot for nothing and confuse the badge.
        if (!club.acceptsBookings) return
        await subscribeToBookingIntents(club.id, handleInsert, handleUpdate)
        if (cancelled) {
          unsubscribeBookingIntents()
          return
        }
        activeUserIdRef.current = userId
        activeClubIdRef.current = club.id
      } catch {
        // Club may not exist yet (owner hasn't set up Player Hub) — silent.
      }
    })()

    return () => {
      cancelled = true
      if (activeUserIdRef.current === userId) {
        unsubscribeBookingIntents()
        activeUserIdRef.current = null
        activeClubIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbReady, userId, subscriptionLoaded, onPublicRoute])

  return null
}
