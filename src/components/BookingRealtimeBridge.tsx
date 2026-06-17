import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToastStore } from '../store/toastStore'
import {
  subscribeToBookingIntents,
  unsubscribeBookingIntents,
  type BookingInsertEvent,
} from '../lib/realtimeBookings'
import { getOwnerClub } from '../lib/playerHubApi'

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
        await subscribeToBookingIntents(club.id, handleInsert)
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
