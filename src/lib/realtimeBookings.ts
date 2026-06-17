import { supabase } from './supabase'
import { useBookingInbox } from '../store/bookingInbox'
import { getPendingBookings } from './playerHubApi'

export interface BookingInsertEvent {
  intentId: string
  tableName: string
  playerName: string | null
  playerPhone: string
  slotStart: string                      // ISO timestamptz
  durationMin: number
  advanceAmount: number
}

let pollingTimer: ReturnType<typeof setInterval> | null = null
let fallbackInitTimer: ReturnType<typeof setTimeout> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null
let activeClubId: string | null = null

function playPendingSound() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(80)
  }
}

export async function subscribeToBookingIntents(
  clubId: string,
  onInsert?: (event: BookingInsertEvent) => void,
): Promise<void> {
  // Idempotent re-call: tear down + rebuild so a new onInsert callback (or
  // a different clubId) replaces the live channel cleanly.
  unsubscribeBookingIntents()
  activeClubId = clubId

  const { setPendingCount, incrementPending, decrementPending } = useBookingInbox.getState()

  // Load initial count
  try {
    const initial = await getPendingBookings(clubId)
    setPendingCount(initial.length)
  } catch {
    // ignore — realtime or polling will fill it in
  }

  let realtimeConnected = false

  channel = supabase
    .channel(`booking_intents_${clubId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'booking_intents',
        filter: `club_id=eq.${clubId}`,
      },
      (payload) => {
        const row = payload.new as {
          id?: string
          status?: string
          table_name?: string
          player_name?: string | null
          player_phone?: string
          slot_start?: string
          duration_min?: number
          advance_amount?: number
        }
        if (row?.status === 'pending') {
          incrementPending()
          playPendingSound()
          if (
            onInsert &&
            row.id &&
            row.table_name &&
            row.player_phone &&
            row.slot_start &&
            typeof row.duration_min === 'number' &&
            typeof row.advance_amount === 'number'
          ) {
            onInsert({
              intentId: row.id,
              tableName: row.table_name,
              playerName: row.player_name ?? null,
              playerPhone: row.player_phone,
              slotStart: row.slot_start,
              durationMin: row.duration_min,
              advanceAmount: row.advance_amount,
            })
          }
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'booking_intents',
        filter: `club_id=eq.${clubId}`,
      },
      (payload) => {
        const oldStatus = (payload.old as { status?: string })?.status
        const newStatus = (payload.new as { status?: string })?.status
        if (oldStatus === 'pending' && newStatus !== 'pending') {
          decrementPending()
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        realtimeConnected = true
        // FIX vs realtimeTopups: cancel the fallback init AND any already-running
        // polling timer the moment realtime connects. The topup version leaves both
        // running once realtime arrives late — known waste-of-bandwidth bug. Do not
        // replicate that here.
        if (fallbackInitTimer) {
          clearTimeout(fallbackInitTimer)
          fallbackInitTimer = null
        }
        if (pollingTimer) {
          clearInterval(pollingTimer)
          pollingTimer = null
        }
      }
    })

  // Fallback: if realtime doesn't connect in 5s, start 30s polling. The check
  // is also rerun inside the .subscribe callback above to cancel polling that
  // started before realtime eventually connected.
  fallbackInitTimer = setTimeout(() => {
    fallbackInitTimer = null
    if (!realtimeConnected) {
      console.log('[realtimeBookings] realtime not connected, falling back to 30s polling')
      pollingTimer = setInterval(async () => {
        try {
          const pending = await getPendingBookings(clubId)
          setPendingCount(pending.length)
        } catch {
          // ignore transient errors
        }
      }, 30_000)
    }
  }, 5_000)
}

export function unsubscribeBookingIntents(): void {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
  if (fallbackInitTimer) {
    clearTimeout(fallbackInitTimer)
    fallbackInitTimer = null
  }
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
  activeClubId = null
}

export function getActiveBookingClubId(): string | null {
  return activeClubId
}
