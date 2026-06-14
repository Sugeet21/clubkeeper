import { supabase } from './supabase'
import { useTopupInbox } from '../store/topupInbox'
import { getPendingTopups } from './playerHubApi'

export interface TopupInsertEvent {
  intentId: string
  playerName: string | null
  playerMobile: string
  amount: number
}

let pollingTimer: ReturnType<typeof setInterval> | null = null
let channel: ReturnType<typeof supabase.channel> | null = null
let activeClubId: string | null = null

function playPendingSound() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(80)
  }
}

export async function subscribeToTopupIntents(
  clubId: string,
  onInsert?: (event: TopupInsertEvent) => void,
): Promise<void> {
  // Idempotent re-call for the same clubId: tear down + rebuild so the
  // (possibly updated) onInsert callback takes effect cleanly. Different
  // clubId likewise replaces the channel.
  unsubscribeTopupIntents()
  activeClubId = clubId

  const { setPendingCount, incrementPending, decrementPending } = useTopupInbox.getState()

  // Load initial count
  try {
    const initial = await getPendingTopups(clubId)
    setPendingCount(initial.length)
  } catch {
    // ignore — realtime or polling will fill it in
  }

  let realtimeConnected = false

  channel = supabase
    .channel(`topup_intents_${clubId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'topup_intents',
        filter: `club_id=eq.${clubId}`,
      },
      (payload) => {
        const row = payload.new as {
          id?: string
          status?: string
          player_name?: string | null
          player_mobile?: string
          amount?: number
        }
        if (row?.status === 'pending') {
          incrementPending()
          playPendingSound()
          if (onInsert && row.id && typeof row.amount === 'number' && row.player_mobile) {
            onInsert({
              intentId: row.id,
              playerName: row.player_name ?? null,
              playerMobile: row.player_mobile,
              amount: row.amount,
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
        table: 'topup_intents',
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
      }
    })

  // Fallback: if realtime doesn't connect in 5s, start 30s polling
  setTimeout(() => {
    if (!realtimeConnected) {
      console.log('[realtimeTopups] realtime not connected, falling back to 30s polling')
      pollingTimer = setInterval(async () => {
        try {
          const pending = await getPendingTopups(clubId)
          setPendingCount(pending.length)
        } catch {
          // ignore transient errors
        }
      }, 30_000)
    }
  }, 5_000)
}

export function unsubscribeTopupIntents(): void {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
  if (pollingTimer) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
  activeClubId = null
}

export function getActiveTopupClubId(): string | null {
  return activeClubId
}
