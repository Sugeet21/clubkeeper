import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { db } from '../db/database'
import {
  pauseSession,
  resumeSession,
  stopSession,
  editSessionStart,
  updateSession,
} from '../db/queries'
import { useTable, useSessionItems, useSettings } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatHMS, formatDuration } from '../lib/time'
import { calculateAmount, calculateItemsTotal, applyRounding } from '../lib/money'
import { Modal } from '../components/Modal'
import { AddItemBottomSheet } from '../components/AddItemBottomSheet'
import { UpiQrCard } from '../components/UpiQrCard'
import type { Session } from '../types'

// ─── Icons ────────────────────────────────────────────────────────────────────

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

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M12.5 2.5l3 3L5 16H2v-3L12.5 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ─── Detail row ───────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  accent = false,
  large = false,
  children,
}: {
  label: string
  value?: string
  accent?: boolean
  large?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0 py-3.5 border-b border-border last:border-0">
      <span className="text-[11px] uppercase tracking-widest font-mono text-text-faint shrink-0">
        {label}
      </span>
      {children ?? (
        <span
          className={`truncate min-w-0 flex-1 text-right font-semibold tabular-nums ${
            large ? 'text-[19px] font-bold' : 'text-[14px]'
          } ${accent ? 'text-accent' : 'text-text'}`}
        >
          {value}
        </span>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPlayers(s: Session): string {
  if (!s.playerName) {
    return `${s.playerCount} player${s.playerCount !== 1 ? 's' : ''}`
  }
  if (s.playerCount <= 1) return s.playerName
  return `${s.playerName} +${s.playerCount - 1}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const sid = Number(sessionId)

  // undefined = loading, null = not found, Session = loaded
  const session = useLiveQuery<Session | null>(
    async () => (await db.sessions.get(sid)) ?? null,
    [sid],
  )

  const table = useTable(session != null ? session.tableId : undefined)
  const items = useSessionItems(session != null ? session.id : undefined)
  const settings = useSettings()

  // Tick every second so the timer re-renders
  useTick()

  const [confirmStop, setConfirmStop] = useState(false)
  const [editStartOpen, setEditStartOpen] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Payment screen state — values cached BEFORE stopSession() so they don't
  // change when the DB record flips to completed (pattern from the build prompt)
  const [paymentScreenOpen, setPaymentScreenOpen] = useState(false)
  const [finalRoundedMs, setFinalRoundedMs] = useState(0)
  const [finalGrandTotal, setFinalGrandTotal] = useState(0)

  // Populate edit-start fields whenever the modal is opened
  useEffect(() => {
    if (!editStartOpen || !session) return
    const dt = new Date(session.startedAt)
    setEditDate(format(dt, 'yyyy-MM-dd'))
    setEditTime(format(dt, 'HH:mm'))
    setEditError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStartOpen])

  // ─── Loading / not-found guards ───────────────────────────────────────────

  if (session === undefined) {
    return (
      <div className="pt-safe min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-faint text-sm font-mono">Loading…</p>
      </div>
    )
  }

  if (session === null) {
    return (
      <div className="pt-safe min-h-screen bg-bg flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-text-dim text-[15px]">Session not found.</p>
        <button
          onClick={() => navigate('/tables')}
          className="text-accent text-sm font-semibold"
        >
          ← Back to Home
        </button>
      </div>
    )
  }

  // ─── Derived values (session: Session is now guaranteed) ──────────────────

  const elapsedMs = getElapsedMs(session)
  const rounding = settings?.rounding ?? 'none'

  // For the confirm preview: compute what WOULD be billed on stop
  const rawElapsedMs = elapsedMs
  const roundedElapsedMs =
    session.billingMode === 'per_hour' ? applyRounding(rawElapsedMs, rounding) : rawElapsedMs
  const previewTableAmount = calculateAmount(
    session.billingMode,
    roundedElapsedMs,
    session.rateSnapshot,
    session.framesPlayed,
  )
  const previewItemsTotal = calculateItemsTotal(items)
  const previewGrandTotal = previewTableAmount + previewItemsTotal

  // Current live display (for the bill split card — uses raw elapsed for running sessions)
  const currentSessionAmount =
    session.status === 'completed'
      ? session.amount
      : calculateAmount(session.billingMode, elapsedMs, session.rateSnapshot, session.framesPlayed)
  const itemsTotal = calculateItemsTotal(items)
  const grandTotal = currentSessionAmount + itemsTotal
  const totalItemQty = items.reduce((s, i) => s + i.quantity, 0)

  const hms = formatHMS(elapsedMs)
  const hhMm = hms.slice(0, 5)
  const ss = hms.slice(6)
  const tableName = table?.name ?? `Table ${session.tableId}`

  // Hero gradient
  const heroBg =
    session.status === 'running'
      ? 'linear-gradient(to bottom, rgba(255,107,74,0.07) 0%, transparent 85%)'
      : session.status === 'paused'
      ? 'linear-gradient(to bottom, rgba(255,184,74,0.07) 0%, transparent 85%)'
      : undefined

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handlePause() {
    if (pending) return
    setPending(true)
    try {
      await pauseSession(session.id!)
    } finally {
      setPending(false)
    }
  }

  async function handleResume() {
    if (pending) return
    setPending(true)
    try {
      await resumeSession(session.id!)
    } finally {
      setPending(false)
    }
  }

  async function handleConfirmStop() {
    if (pending) return
    setPending(true)
    try {
      // Capture billable values BEFORE stopping so the payment screen shows
      // exactly what was stored — stopSession() uses the same math
      const nowElapsed = getElapsedMs(session)
      const billableMs =
        session.billingMode === 'per_hour' ? applyRounding(nowElapsed, rounding) : nowElapsed
      const tableAmt = calculateAmount(
        session.billingMode, billableMs, session.rateSnapshot, session.framesPlayed,
      )
      const itemsNow = calculateItemsTotal(items)
      setFinalRoundedMs(billableMs)
      setFinalGrandTotal(tableAmt + itemsNow)

      await stopSession(session.id!)
      setConfirmStop(false)
      setPaymentScreenOpen(true)
    } finally {
      setPending(false)
    }
  }

  async function handleFrameChange(delta: number) {
    const current = session.framesPlayed ?? 0
    const next = Math.max(0, current + delta)
    await updateSession(session.id!, { framesPlayed: next })
  }

  async function handleSaveEditStart() {
    setEditError(null)
    const combined = new Date(`${editDate}T${editTime}:00`)
    if (isNaN(combined.getTime())) {
      setEditError('Invalid date or time.')
      return
    }
    const newTs = combined.getTime()
    if (newTs >= Date.now()) {
      setEditError('Start time must be in the past.')
      return
    }
    if (session.endedAt !== null && newTs >= session.endedAt) {
      setEditError('Start time must be before end time.')
      return
    }
    try {
      await editSessionStart(session.id!, newTs)
      setEditStartOpen(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update.')
    }
  }

  const isActive = session.status !== 'completed'

  // ─── Payment screen (shown after session stop) ────────────────────────────
  // Fixed-viewport, no-scroll layout. QR centered in flex-1 middle.
  // Bottom nav is intentionally hidden — this is a payment moment.

  if (paymentScreenOpen) {
    const upiId = settings?.upiId?.trim()
    const clubName = settings?.clubName || 'ClubKeeper'
    const transactionNote = `${tableName} - ${formatDuration(finalRoundedMs)}`

    // Duration label: <1m → "<1 min", 1-59m → "12 min", 60+m → "1h 12m"
    function durationLabel(ms: number): string {
      const totalMin = Math.floor(ms / 60000)
      if (totalMin < 1) return '<1 min'
      if (totalMin < 60) return `${totalMin} min`
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      return m > 0 ? `${h}h ${m}m` : `${h}h`
    }

    const summaryLine = session.playerName
      ? `${tableName} · ${durationLabel(finalRoundedMs)} · ${session.playerName}`
      : `${tableName} · ${durationLabel(finalRoundedMs)}`

    return (
      <div
        className="fixed inset-0 z-50 bg-bg flex flex-col px-5"
        style={{
          paddingTop: 'max(12px, env(safe-area-inset-top))',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        }}
      >
        {/* Compact header */}
        <header className="flex flex-col items-center gap-1 shrink-0 pt-2">
          <div className="flex items-center gap-2 text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold uppercase tracking-widest">Session ended</span>
          </div>
          <div className="text-text-dim text-xs">{summaryLine}</div>
        </header>

        {/* Hero — QR + amount, fills remaining vertical space */}
        <main className="flex-1 flex flex-col items-center justify-center min-h-0 gap-4">
          {upiId ? (
            <>
              <UpiQrCard
                upiId={upiId}
                payeeName={clubName}
                amount={finalGrandTotal}
                transactionNote={transactionNote}
              />
              <div className="flex flex-col items-center gap-1">
                <div className="text-3xl font-mono font-bold text-text tabular-nums">
                  ₹{finalGrandTotal.toLocaleString('en-IN')}
                </div>
                <div className="text-xs text-text-dim">Scan to pay exact amount</div>
              </div>
            </>
          ) : (
            <div className="bg-bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-2 w-full max-w-xs">
              <div className="text-3xl font-mono font-bold text-text tabular-nums">
                ₹{finalGrandTotal.toLocaleString('en-IN')}
              </div>
              <div className="text-text-dim text-sm">to collect from player</div>
              <p className="text-text-faint text-xs text-center mt-1">
                Add your UPI ID in Settings to show a payment QR here.
              </p>
            </div>
          )}
        </main>

        {/* Footer — pinned at bottom, z-50 overlay guarantees it's above BottomNav */}
        <footer className="shrink-0 flex flex-col gap-3 pt-2">
          {upiId && (
            <p className="text-xs text-text-faint text-center max-w-xs mx-auto">
              Works with GPay, PhonePe, Paytm, BHIM
            </p>
          )}
          <button
            onClick={() => navigate('/tables', { replace: true })}
            className="w-full min-h-[48px] rounded-xl bg-accent text-bg font-semibold text-base active:scale-[0.98] transition-transform"
          >
            Done — back to tables
          </button>
        </footer>
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg pb-24">

      {/* Top bar */}
      <div className="pt-safe">
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <button
            onClick={() => navigate('/tables')}
            className="flex items-center gap-1 text-text-dim px-1 min-h-[44px] -ml-1 active:text-text transition-colors"
          >
            <ChevronLeft />
            <span className="text-sm">Home</span>
          </button>
          <button
            onClick={() => setEditStartOpen(true)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim active:text-text transition-colors"
            aria-label="Edit start time"
          >
            <PencilIcon />
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="px-4 pt-2 pb-7" style={{ background: heroBg }}>
        <div className="mb-3">
          {session.status === 'running' && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-busy">
              <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse" />
              Live Session
            </span>
          )}
          {session.status === 'paused' && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-paused">
              <span className="w-1.5 h-1.5 rounded-full bg-paused" />
              Paused
            </span>
          )}
          {session.status === 'completed' && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Completed
            </span>
          )}
        </div>
        <h1 className="text-[32px] font-extrabold tracking-tighter text-text leading-none mb-2">
          {tableName}
        </h1>
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-faint">
          {table?.gameType ?? '—'}
          {' · '}₹{session.rateSnapshot}/{session.billingMode === 'per_hour' ? 'hr' : 'frame'}
          {' · '}Started {format(session.startedAt, 'h:mm a')}
        </p>
      </div>

      {/* Big timer */}
      <div className="flex flex-col items-center py-9">
        <div
          className="font-mono font-bold tracking-tighter leading-none"
          style={{ fontSize: '64px' }}
        >
          <span className={session.status === 'paused' ? 'text-paused' : 'text-text'}>
            {hhMm}
          </span>
          <span
            style={{ fontSize: '42px' }}
            className={session.status === 'paused' ? 'text-paused/60' : 'text-text-dim'}
          >
            :{ss}
          </span>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mt-3">
          Elapsed Time
        </p>
      </div>

      {/* Detail rows */}
      <div className="px-4 border-t border-border">
        <DetailRow label="Players" value={formatPlayers(session)} />
        <DetailRow
          label="Started At"
          value={format(session.startedAt, 'h:mm a, d MMM')}
        />
        <DetailRow
          label="Rate"
          value={`₹${session.rateSnapshot}/${session.billingMode === 'per_hour' ? 'hr' : 'frame'}`}
        />

        {/* Frames stepper — per_frame billing only */}
        {session.billingMode === 'per_frame' && (
          <DetailRow label="Frames">
            <div className="flex items-center gap-4">
              <button
                onClick={() => handleFrameChange(-1)}
                disabled={(session.framesPlayed ?? 0) <= 0 || !isActive}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-xl font-bold text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors"
              >
                −
              </button>
              <span className="text-[20px] font-bold text-text w-8 text-center tabular-nums">
                {session.framesPlayed ?? 0}
              </span>
              <button
                onClick={() => handleFrameChange(1)}
                disabled={!isActive}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-xl font-bold text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors"
              >
                +
              </button>
            </div>
          </DetailRow>
        )}

        {session.note && (
          <DetailRow label="Note" value={session.note} />
        )}
      </div>

      {/* ── Bill split ──────────────────────────────────────────────────────── */}
      <div className="px-4 mt-5">
        <div className="bg-bg-card border border-border rounded-2xl p-4 space-y-2.5">
          <div className="flex justify-between items-baseline">
            <span className="text-text-dim text-sm">Table time</span>
            <span className="font-mono text-text">₹{currentSessionAmount.toLocaleString('en-IN')}</span>
          </div>
          {items.length > 0 && (
            <div className="flex justify-between items-baseline">
              <span className="text-text-dim text-sm">Items ({totalItemQty})</span>
              <span className="font-mono text-text">₹{itemsTotal.toLocaleString('en-IN')}</span>
            </div>
          )}
          <div className="h-px bg-border my-1" />
          <div className="flex justify-between items-baseline">
            <span className="text-text font-medium">Total</span>
            <span className="font-mono text-accent text-xl font-bold">₹{grandTotal.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 mt-4 space-y-3">
        {session.status === 'completed' ? (
          <button
            onClick={() => navigate('/tables')}
            className="w-full py-4 bg-bg-card text-text border border-border rounded-2xl text-[15px] font-bold active:scale-[0.99] transition-transform"
          >
            Back to Home
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {session.status === 'running' ? (
              <button
                onClick={handlePause}
                disabled={pending}
                className="py-4 bg-paused/10 text-paused border border-paused/30 rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={handleResume}
                disabled={pending}
                className="py-4 bg-accent text-bg rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
              >
                Resume
              </button>
            )}
            <button
              onClick={() => setConfirmStop(true)}
              disabled={pending}
              className="py-4 bg-busy text-white rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              Stop Session
            </button>
          </div>
        )}

        {/* Add Item / View Items button */}
        {!isActive ? (
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full min-h-[44px] bg-bg-card text-text-dim border border-border rounded-2xl flex items-center justify-center gap-2 font-medium text-[14px] active:scale-[0.99] transition-transform"
          >
            View Items
          </button>
        ) : (
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full min-h-[44px] bg-bg-card text-text border border-border rounded-2xl flex items-center justify-center gap-2 font-medium text-[15px] active:scale-[0.99] transition-transform"
          >
            <PlusIcon />
            Add Item
          </button>
        )}

        {/* Edit start time */}
        <button
          onClick={() => setEditStartOpen(true)}
          className="w-full py-3.5 bg-bg-card text-text-dim border border-border rounded-2xl text-[14px] font-semibold active:scale-[0.99] transition-transform"
        >
          Edit Start Time
        </button>
      </div>

      {/* ── Stop confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={confirmStop}
        onClose={() => !pending && setConfirmStop(false)}
        title="End this session?"
      >
        <div className="space-y-3 mb-5">
          <div className="text-text-dim text-sm">
            End session for <span className="text-text font-medium">{tableName}</span>?
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-3 space-y-1.5 text-sm">
            {/* Time row — shows rounding if active */}
            <div className="flex justify-between">
              <span className="text-text-dim">Time</span>
              <span className="text-text font-mono">
                {formatDuration(roundedElapsedMs)}
                {roundedElapsedMs !== rawElapsedMs && (
                  <span className="text-text-faint text-xs ml-1">
                    (was {formatDuration(rawElapsedMs)})
                  </span>
                )}
              </span>
            </div>
            {/* Table time */}
            <div className="flex justify-between">
              <span className="text-text-dim">Table time</span>
              <span className="text-text font-mono">₹{previewTableAmount.toLocaleString('en-IN')}</span>
            </div>
            {/* Items row — only if present */}
            {items.length > 0 && (
              <div className="flex justify-between">
                <span className="text-text-dim">
                  Items ({items.reduce((s, i) => s + i.quantity, 0)})
                </span>
                <span className="text-text font-mono">₹{previewItemsTotal.toLocaleString('en-IN')}</span>
              </div>
            )}
            <div className="h-px bg-border my-1" />
            {/* Grand total */}
            <div className="flex justify-between items-baseline">
              <span className="text-text font-medium">Total</span>
              <span className="text-accent font-mono text-lg font-bold">
                ₹{previewGrandTotal.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setConfirmStop(false)}
            disabled={pending}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmStop}
            disabled={pending}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {pending ? 'Ending…' : 'Yes, End Session'}
          </button>
        </div>
      </Modal>

      {/* ── Edit start time modal ───────────────────────────────────────── */}
      <Modal
        open={editStartOpen}
        onClose={() => setEditStartOpen(false)}
        title="Edit Start Time"
      >
        <p className="text-text-faint text-[12px] font-mono mb-4">
          Current: {format(session.startedAt, 'h:mm a, d MMM yyyy')}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
              Date
            </label>
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
              Time
            </label>
            <input
              type="time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors"
            />
          </div>
          {editError && (
            <p className="text-busy text-[13px]">{editError}</p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => setEditStartOpen(false)}
              className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEditStart}
              className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add Item bottom sheet ───────────────────────────────────────── */}
      <AddItemBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sessionId={session.id!}
        sessionStatus={session.status}
      />
    </div>
  )
}
