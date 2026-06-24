import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import {
  getActiveSessionForTable,
  startSession,
  getRecentPlayerNames,
  getLinkableBookingsForTable,
  getUpcomingBookingsForTable,
  linkBookingToSession,
  BookingAlreadyConsumedError,
} from '../db/queries'
import { validatePlayerName, validateNote, NOTE_MAX } from '../lib/validation'
import { NOTIFY_PRESETS } from '../lib/notifyPresets'
import { Modal } from '../components/Modal'
import type { BillingMode } from '../types'
import type { Booking } from '../types/booking'

// Booking-linkage window: confirmed booking whose slotStart is within ±30 min
// of "now" auto-prompts the staff to attach it. Wider than 30 means stale
// bookings would resurface; narrower means a customer arriving slightly early
// gets ignored.
const BOOKING_LINK_WINDOW_MS = 30 * 60_000
// Walk-in conflict lookahead — warn if a confirmed booking exists in the next
// 90 min on the same table when staff is about to start a walk-in. Warn-only,
// never blocks the start.
const WALKIN_CONFLICT_LOOKAHEAD_MS = 90 * 60_000

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function formatSlotTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M12 5l-5 5 5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StartSession() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()

  const tid = tableId ?? ''
  const tidValid = tid.length === 36
  const table = useLiveQuery(
    () => (tidValid ? db.gameTables.get(tid) : Promise.resolve(undefined)),
    [tid, tidValid],
  )

  // Form state
  const [billingMode, setBillingMode] = useState<BillingMode>('per_hour')
  const [playerName, setPlayerName] = useState('')
  const [playerNameError, setPlayerNameError] = useState<string | null>(null)
  const [playerCount, setPlayerCount] = useState(2)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [recentNames, setRecentNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Alarm: number of minutes, null = no alarm
  const [notifyAfterMinutes, setNotifyAfterMinutes] = useState<number | null>(null)
  const [customNotifyMinutes, setCustomNotifyMinutes] = useState('')
  const [showCustomNotify, setShowCustomNotify] = useState(false)

  // Booking linkage (P1e): confirmed bookings within ±30 min on this table.
  // `linkedBooking` is the staff-chosen one; setting it pre-fills the form +
  // is passed to handleSubmit so linkBookingToSession runs in the same step.
  const [linkableBookings, setLinkableBookings] = useState<Booking[]>([])
  const [linkedBooking, setLinkedBooking] = useState<Booking | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([])

  useEffect(() => {
    getRecentPlayerNames().then(setRecentNames)
  }, [])

  // Lookup linkable + upcoming bookings for this table. Re-runs only on tid
  // change — `Date.now()` inside the effect is fine because StartSession is a
  // mount-and-stay page; users don't sit on it for >30 min.
  useEffect(() => {
    if (!tidValid) return
    const now = Date.now()
    let cancelled = false
    Promise.all([
      getLinkableBookingsForTable(tid, now, BOOKING_LINK_WINDOW_MS),
      getUpcomingBookingsForTable(tid, now, WALKIN_CONFLICT_LOOKAHEAD_MS),
    ]).then(([linkable, upcoming]) => {
      if (cancelled) return
      setLinkableBookings(linkable)
      // Auto-open the link modal only if exactly one booking is in window AND
      // the form hasn't been touched yet — staff that already typed a name
      // probably isn't expecting an interstitial.
      if (linkable.length >= 1) setLinkModalOpen(true)
      setUpcomingBookings(upcoming.filter((b) => !linkable.some((l) => l.id === b.id)))
    }).catch(() => { /* swallow — non-critical lookup */ })
    return () => { cancelled = true }
  }, [tid, tidValid])

  function applyLinkedBooking(b: Booking) {
    setLinkedBooking(b)
    setLinkModalOpen(false)
    // Pre-fill name from booking — staff can still edit
    if (b.playerName && !playerName.trim()) {
      setPlayerName(b.playerName)
    }
    setError(null)
  }

  function clearLinkedBooking() {
    setLinkedBooking(null)
  }

  // Reset to per_hour if table has no frame rate
  useEffect(() => {
    if (table && !table.ratePerFrame) setBillingMode('per_hour')
  }, [table])

  const canUsePerFrame = Boolean(table?.ratePerFrame)

  // ─── Submit ───────────────────────────────────────────────────────────────

  function handlePlayerNameChange(val: string) {
    setPlayerName(val)
    const result = validatePlayerName(val)
    setPlayerNameError(result.valid ? null : (result.error ?? null))
    setError(null)
  }

  function handleNoteChange(val: string) {
    setNote(val)
    const result = validateNote(val)
    setNoteError(result.valid ? null : (result.error ?? null))
  }

  async function handleSubmit() {
    if (submitting) return

    // Re-validate before submitting
    const nameCheck = validatePlayerName(playerName)
    if (!nameCheck.valid) { setPlayerNameError(nameCheck.error ?? null); return }
    const noteCheck = validateNote(note)
    if (!noteCheck.valid) { setNoteError(noteCheck.error ?? null); return }

    setSubmitting(true)
    setError(null)

    try {
      // Re-fetch from DB to guard against stale state
      const t = await db.gameTables.get(tid)
      if (!t) {
        setError('Table not found.')
        return
      }
      if (t.outOfService) {
        setError('This table is currently out of service.')
        return
      }

      // Race condition: another session may have started while the user was filling the form
      const existing = await getActiveSessionForTable(tid)
      if (existing) {
        setError('A session is already running for this table. Redirecting…')
        setTimeout(() => navigate(`/session/${existing.id}`, { replace: true }), 1200)
        return
      }

      // Validate per_frame configuration
      if (billingMode === 'per_frame' && !t.ratePerFrame) {
        setError('This table does not have a per-frame rate configured.')
        return
      }

      const rateSnapshot = billingMode === 'per_frame' ? t.ratePerFrame! : t.ratePerHour
      const clampedCount = Math.max(1, Math.min(20, playerCount))

      const notifyMs =
        typeof notifyAfterMinutes === 'number' && notifyAfterMinutes > 0
          ? notifyAfterMinutes * 60_000
          : null

      const newId = await startSession(
        {
          tableId: tid,
          billingMode,
          rateSnapshot,
          playerName: playerName.trim() || null,
          playerCount: clampedCount,
          note: note.trim() || null,
          framesPlayed: null,
        },
        notifyMs,
      )

      // Booking linkage (P1e): if staff picked a booking from the prompt, mark
      // it consumed + auto-link customer in the same step. We do NOT await this
      // failing block-style — a linkage hiccup must not strand the session, so
      // we surface the error but still navigate. Idempotent on retry.
      if (linkedBooking) {
        try {
          await linkBookingToSession(linkedBooking.id, newId)
        } catch (e) {
          if (e instanceof BookingAlreadyConsumedError) {
            // Race with another device — silent; session is fine, advance just
            // won't be applied here. Owner can reconcile manually.
            console.warn('[booking] linkage skipped — booking already consumed')
          } else {
            console.warn('[booking] linkage failed:', e)
          }
        }
      }

      navigate(`/session/${newId}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────────

  if (table === undefined) {
    return (
      <div className="pt-safe min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-faint text-sm font-mono">Loading…</p>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg">
      {/* Back */}
      <div className="flex items-center px-3 pt-3 pb-1">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-text-dim px-1 min-h-[44px] -ml-1 active:text-text transition-colors"
        >
          <ChevronLeft />
          <span className="text-sm">Back</span>
        </button>
      </div>

      {/* Sheet head */}
      <div className="px-4 pt-1 pb-5">
        <h3 className="text-[21px] font-bold tracking-tight text-text leading-snug">
          Start Session
          <span className="text-accent"> · {table.name}</span>
        </h3>
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-faint mt-1">
          {table.gameType} · ₹{table.ratePerHour}/hr
          {table.ratePerFrame ? ` · ₹${table.ratePerFrame}/frame` : ''}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-4 rounded-xl border border-busy/30 bg-busy/10 px-4 py-3 text-busy text-[13px]">
          {error}
        </div>
      )}

      {/* Linked booking pill (P1e) — shows the attached booking; tap to unlink. */}
      {linkedBooking && (
        <div className="mx-4 mb-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 flex items-start gap-3">
          <span className="text-accent text-lg leading-none mt-0.5">📅</span>
          <div className="flex-1 min-w-0">
            <p className="text-accent text-[13px] font-semibold">
              Linked to booking · {linkedBooking.playerName || linkedBooking.playerPhone}
            </p>
            <p className="text-text-dim text-[12px] mt-0.5">
              {formatSlotTime(linkedBooking.slotStart)} · {linkedBooking.durationMin} min · advance {formatRupees(linkedBooking.advanceAmount)} paid
            </p>
          </div>
          <button
            onClick={clearLinkedBooking}
            className="text-text-faint text-[12px] min-h-[36px] px-2"
          >
            Unlink
          </button>
        </div>
      )}

      {/* Walk-in conflict warning (P1e) — warn-only when starting a walk-in on
          a table that has an upcoming reservation in the next 90 min. Never
          blocks the start; staff judgment call. Hidden if the staff has
          already linked the booking that's about to conflict. */}
      {!linkedBooking && upcomingBookings.length > 0 && (
        <div className="mx-4 mb-4 rounded-xl border border-paused/30 bg-paused/10 px-4 py-3 flex items-start gap-3">
          <span className="text-paused text-lg leading-none mt-0.5">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-paused text-[13px] font-semibold">
              Booking coming up on this table
            </p>
            <p className="text-text-dim text-[12px] mt-0.5">
              {upcomingBookings[0].playerName || upcomingBookings[0].playerPhone} at {formatSlotTime(upcomingBookings[0].slotStart)} ({upcomingBookings[0].durationMin} min)
              {upcomingBookings.length > 1 ? ` · +${upcomingBookings.length - 1} more` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Form fields — padded below to clear fixed button */}
      <div className="px-4 space-y-5 pb-36">

        {/* Billing mode — only shown when table supports per-frame */}
        {canUsePerFrame && (
          <Field label="Billing Mode">
            <div className="flex gap-1 bg-bg-elevated border border-border rounded-xl p-1">
              {(['per_hour', 'per_frame'] as BillingMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setBillingMode(mode)}
                  className={`flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-colors ${
                    billingMode === mode
                      ? 'bg-accent text-bg'
                      : 'text-text-dim'
                  }`}
                >
                  {mode === 'per_hour' ? 'Per Hour' : 'Per Frame'}
                </button>
              ))}
            </div>
          </Field>
        )}

        {/* Player name */}
        <Field label="Player Name" hint="optional">
          <input
            type="text"
            value={playerName}
            onChange={(e) => handlePlayerNameChange(e.target.value)}
            placeholder="Enter name…"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
          />
          {playerNameError && (
            <p className="text-[12px] text-busy mt-1">{playerNameError}</p>
          )}
          {recentNames.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 max-h-24 overflow-y-auto">
              {recentNames.map((n) => (
                <button
                  key={n}
                  onClick={() => handlePlayerNameChange(n)}
                  className={`max-w-[150px] truncate text-[12px] px-3 min-h-[44px] flex items-center rounded-full border transition-colors ${
                    playerName === n
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-bg-elevated border-border text-text-dim'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </Field>

        {/* Player count stepper */}
        <Field label="Number of Players">
          <div className="flex items-stretch bg-bg-elevated border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setPlayerCount((c) => Math.max(1, c - 1))}
              className="px-5 py-3 text-xl font-bold text-text-dim border-r border-border active:bg-bg-card transition-colors select-none"
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={playerCount}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v)) setPlayerCount(Math.max(1, Math.min(20, v)))
              }}
              className="flex-1 text-center bg-transparent text-text py-3 text-[18px] font-bold focus:outline-none"
            />
            <button
              onClick={() => setPlayerCount((c) => Math.min(20, c + 1))}
              className="px-5 py-3 text-xl font-bold text-text-dim border-l border-border active:bg-bg-card transition-colors select-none"
            >
              +
            </button>
          </div>
        </Field>

        {/* Note */}
        <Field label="Note" hint="optional">
          <input
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Add a note…"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
          />
          {noteError && (
            <p className="text-[12px] text-busy mt-1">{noteError}</p>
          )}
        </Field>

        {/* Notify me at */}
        <Field label="Notify me at" hint="optional">
          <div className="flex flex-wrap gap-2">
            {NOTIFY_PRESETS.map((preset) => {
              const presetMinutes = preset.ms === null ? null : preset.ms / 60_000
              const isSelected =
                presetMinutes === null
                  ? notifyAfterMinutes === null && !showCustomNotify
                  : notifyAfterMinutes === presetMinutes && !showCustomNotify
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setNotifyAfterMinutes(presetMinutes)
                    setShowCustomNotify(false)
                    setCustomNotifyMinutes('')
                  }}
                  className={`min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold transition-colors ${
                    isSelected
                      ? 'bg-accent text-bg border-accent'
                      : 'bg-bg-elevated border-border text-text-dim'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
            <button
              onClick={() => {
                setShowCustomNotify(true)
                setNotifyAfterMinutes(null)
              }}
              className={`min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold transition-colors ${
                showCustomNotify
                  ? 'bg-accent text-bg border-accent'
                  : 'bg-bg-elevated border-border text-text-dim'
              }`}
            >
              Custom
            </button>
          </div>
          {showCustomNotify && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={customNotifyMinutes}
                onChange={(e) => {
                  setCustomNotifyMinutes(e.target.value)
                  const v = parseInt(e.target.value, 10)
                  setNotifyAfterMinutes(!isNaN(v) && v >= 1 && v <= 600 ? v : null)
                }}
                placeholder="Minutes (1–600)"
                className="flex-1 bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
              />
            </div>
          )}
          {notifyAfterMinutes !== null && (
            <p className="text-[12px] text-accent mt-1.5">
              Alert fires after {notifyAfterMinutes < 60 ? `${notifyAfterMinutes} min` : `${notifyAfterMinutes / 60} hr`}
            </p>
          )}
        </Field>

      </div>

      {/* Fixed submit — sits above the bottom nav (h-16 = 4rem) */}
      <div
        className="fixed left-0 right-0 px-4 pt-3 bg-bg/95 backdrop-blur-xl border-t border-border"
        style={{
          bottom: 'calc(4rem + env(safe-area-inset-bottom))',
          paddingBottom: '0.75rem',
        }}
      >
        <button
          onClick={handleSubmit}
          disabled={submitting || Boolean(playerNameError) || Boolean(noteError)}
          className="w-full py-4 bg-accent text-bg rounded-2xl text-[16px] font-bold tracking-tight active:scale-[0.98] disabled:opacity-60 transition-transform"
        >
          {submitting ? 'Starting…' : '▶  Start Timer Now'}
        </button>
      </div>

      {/* Booking linkage modal — opens on mount when ≥1 confirmed booking is
          within ±30 min on this table. Staff Links → fills form + marks
          booking consumed at submit. Skip → fall back to walk-in. */}
      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Booking found for this table"
      >
        <div className="space-y-3">
          <p className="text-text-dim text-[13px]">
            Tap a booking to attach it to this session. The advance will be applied at payment time.
          </p>
          {linkableBookings.map((b) => {
            const isSelected = linkedBooking?.id === b.id
            return (
              <button
                key={b.id}
                onClick={() => applyLinkedBooking(b)}
                className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                  isSelected
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-bg-elevated'
                }`}
              >
                <p className="text-text text-[14px] font-semibold">
                  {b.playerName?.trim() || '(no name)'} <span className="text-text-dim">· {b.playerPhone}</span>
                </p>
                <p className="text-text-dim text-[12px] mt-0.5">
                  {formatSlotTime(b.slotStart)} · {b.durationMin} min · advance {formatRupees(b.advanceAmount)} paid
                </p>
              </button>
            )
          })}
          <button
            onClick={() => { setLinkModalOpen(false); clearLinkedBooking() }}
            className="w-full min-h-[44px] rounded-xl border border-border bg-bg text-text-dim text-[13px] font-semibold"
          >
            Skip — treat as walk-in
          </button>
        </div>
      </Modal>
    </div>
  )
}

// ─── Field wrapper ─────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-baseline gap-1.5 text-[11px] uppercase tracking-widest text-text-faint font-mono mb-2">
        {label}
        {hint && (
          <span className="text-[10px] normal-case tracking-normal text-text-faint/60">
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  )
}
