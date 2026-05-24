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
import { useTable } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatHMS, formatDuration } from '../lib/time'
import { calculateAmount } from '../lib/money'
import { Modal } from '../components/Modal'
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

  // Tick every second so the timer re-renders
  useTick()

  const [confirmStop, setConfirmStop] = useState(false)
  const [editStartOpen, setEditStartOpen] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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
  const liveAmount =
    session.status === 'completed'
      ? session.amount
      : calculateAmount(session.billingMode, elapsedMs, session.rateSnapshot, session.framesPlayed)

  const hms = formatHMS(elapsedMs)          // "HH:MM:SS"
  const hhMm = hms.slice(0, 5)              // "HH:MM"
  const ss = hms.slice(6)                   // "SS"
  const tableName = table?.name ?? `Table ${session.tableId}`

  // Hero gradient (inline style since Tailwind v3 from-X/[%] requires known RGB)
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

  async function handleStop() {
    if (pending) return
    setPending(true)
    try {
      await stopSession(session.id!)
      navigate('/tables', { replace: true })
    } finally {
      setPending(false)
      setConfirmStop(false)
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
        {/* Status tag */}
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

        {/* Table name */}
        <h1 className="text-[32px] font-extrabold tracking-tighter text-text leading-none mb-2">
          {tableName}
        </h1>

        {/* Meta */}
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
        <DetailRow label="Running Total" value={`₹${liveAmount}`} accent large />

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

        {/* Note — only shown if present */}
        {session.note && (
          <DetailRow label="Note" value={session.note} />
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 mt-5 space-y-3">
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

        {/* Edit start time — shown for all states */}
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
        <p className="text-text-dim text-[14px] mb-5 font-mono">
          {tableName}
          <span className="text-text-faint"> — </span>
          {formatDuration(elapsedMs)}
          <span className="text-text-faint"> — </span>
          <span className="text-accent font-semibold">₹{liveAmount}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setConfirmStop(false)}
            disabled={pending}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleStop}
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
    </div>
  )
}
