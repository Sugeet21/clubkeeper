import { useState, useCallback } from 'react'
import { Modal } from './Modal'
import { db } from '../db/database'
import { useBookingInbox } from '../store/bookingInbox'
import { useToastStore } from '../store/toastStore'
import { confirmBookingIntent, rejectBookingIntent } from '../lib/playerHubApi'
import type { PendingBookingRow } from '../lib/playerHubApi'
import type { Booking } from '../types/booking'
import type { GameType } from '../types'

interface Props {
  intents: PendingBookingRow[]
  onIntentHandled: (intentId: string) => void
}

type RowState = 'idle' | 'confirming' | 'rejecting' | 'done'

interface RowStatus {
  state: RowState
  error: string | null
}

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function formatSlot(isoStart: string, isoEnd: string): string {
  const start = new Date(isoStart)
  const end = new Date(isoEnd)
  const dateLabel = start.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const timeFmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
  const startStr = start.toLocaleTimeString('en-IN', timeFmt)
  const endStr = end.toLocaleTimeString('en-IN', timeFmt)
  return `${dateLabel} · ${startStr} – ${endStr}`
}

function ConfirmRow({
  intent,
  onHandled,
}: {
  intent: PendingBookingRow
  onHandled: (id: string) => void
}) {
  const { decrementPending } = useBookingInbox()
  const { show: showToast } = useToastStore()
  const [rowStatus, setRowStatus] = useState<RowStatus>({ state: 'idle', error: null })

  const handleConfirm = useCallback(async () => {
    setRowStatus({ state: 'confirming', error: null })
    try {
      // 1. Supabase write FIRST (per D-2026-06-11 / Pattern R2). Returns the
      //    server timestamp so the Dexie row uses the SAME ISO confirmed_at
      //    as Supabase (no clock-skew drift).
      const confirmedAtIso = await confirmBookingIntent(intent.id)

      // 2. Dexie write: insert the permanent booking row. Idempotency guard —
      //    if a row with this id already exists (rapid double-tap, retried
      //    confirm), .add() throws ConstraintError; we treat that as success.
      const booking: Booking = {
        id: intent.id,                         // carry intent UUID verbatim
        tableId: intent.tableId,
        playerName: intent.playerName,
        playerPhone: intent.playerPhone,
        slotStart: new Date(intent.slotStart).getTime(),
        slotEnd: new Date(intent.slotEnd).getTime(),
        durationMin: intent.durationMin,
        gameType: intent.gameType as GameType,
        tierPrice: intent.tierPrice,
        advanceAmount: intent.advanceAmount,
        status: 'confirmed',
        confirmedAt: new Date(confirmedAtIso).getTime(),
        notes: intent.notes ?? undefined,
      }
      try {
        await db.bookings.add(booking)
      } catch (e: unknown) {
        // Already-confirmed re-tap path. Don't surface as error.
        const msg = e instanceof Error ? e.message.toLowerCase() : ''
        if (!msg.includes('key already exists') && !msg.includes('constraint')) {
          throw e
        }
      }

      decrementPending()
      setRowStatus({ state: 'done', error: null })
      onHandled(intent.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to confirm'
      setRowStatus({ state: 'idle', error: msg })
      showToast(`Failed to confirm: ${msg}`, 4000)
    }
  }, [intent, decrementPending, onHandled, showToast])

  const handleReject = useCallback(async () => {
    setRowStatus({ state: 'rejecting', error: null })
    try {
      // Reject is Supabase-only — nothing written to Dexie (P1 architecture).
      await rejectBookingIntent(intent.id)
      decrementPending()
      setRowStatus({ state: 'done', error: null })
      onHandled(intent.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to reject'
      setRowStatus({ state: 'idle', error: msg })
    }
  }, [intent, decrementPending, onHandled])

  const shortCode = `BOOK-${intent.id.slice(-6).toUpperCase()}`
  if (rowStatus.state === 'done') return null

  const busy = rowStatus.state === 'confirming' || rowStatus.state === 'rejecting'

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[15px] font-semibold text-text">{intent.tableName}</span>
        <span className="text-[11px] font-mono text-accent tracking-wider">{shortCode}</span>
      </div>
      <p className="text-text text-[13px] text-text-dim">
        {formatSlot(intent.slotStart, intent.slotEnd)}
      </p>
      <p className="text-text text-[14px] mt-1">
        {intent.playerName?.trim() || '(no name)'}
        <span className="text-text-dim"> · {intent.playerPhone}</span>
      </p>
      <div className="flex items-center gap-3 mt-1">
        <span className="text-text-faint text-[12px]">{intent.durationMin} min</span>
        <span className="text-text-faint text-[12px]">·</span>
        <span className="text-text-faint text-[12px]">Tier {formatRupees(intent.tierPrice)}</span>
        <span className="text-text-faint text-[12px]">·</span>
        <span className="text-accent text-[12px] font-semibold">Advance {formatRupees(intent.advanceAmount)}</span>
      </div>
      {intent.notes && (
        <p className="text-text-faint text-[12px] mt-1 italic">"{intent.notes}"</p>
      )}

      {rowStatus.error && (
        <p className="text-busy text-[12px] mt-2">{rowStatus.error}</p>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleConfirm}
          disabled={busy}
          className={`flex-1 min-h-[44px] rounded-xl text-[13px] font-bold transition-opacity ${
            busy
              ? 'bg-free/20 text-free/60 cursor-not-allowed'
              : 'bg-free/12 text-free border border-free/30'
          }`}
        >
          {rowStatus.state === 'confirming' ? 'Confirming…' : 'Confirm booking'}
        </button>
        <button
          onClick={handleReject}
          disabled={busy}
          className="flex-1 min-h-[44px] bg-busy/12 text-busy border border-busy/30 rounded-xl text-[13px] font-bold"
        >
          {rowStatus.state === 'rejecting' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </div>
  )
}

export default function PendingBookingsModal({ intents, onIntentHandled }: Props) {
  const { modalOpen, closeModal } = useBookingInbox()

  return (
    <Modal
      open={modalOpen}
      onClose={closeModal}
      title={`Pending Bookings (${intents.length})`}
    >
      {intents.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-text-dim text-sm">No pending bookings</p>
        </div>
      ) : (
        <div className="py-2">
          {intents.map((intent) => (
            <ConfirmRow
              key={intent.id}
              intent={intent}
              onHandled={onIntentHandled}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}
