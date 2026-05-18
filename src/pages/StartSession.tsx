import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { getActiveSessionForTable, startSession, getRecentPlayerNames } from '../db/queries'
import type { BillingMode } from '../types'

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

  const tid = Number(tableId)
  const table = useLiveQuery(() => db.gameTables.get(tid), [tid])

  // Form state
  const [billingMode, setBillingMode] = useState<BillingMode>('per_hour')
  const [playerName, setPlayerName] = useState('')
  const [playerCount, setPlayerCount] = useState(2)
  const [note, setNote] = useState('')
  const [recentNames, setRecentNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getRecentPlayerNames().then(setRecentNames)
  }, [])

  // Reset to per_hour if table has no frame rate
  useEffect(() => {
    if (table && !table.ratePerFrame) setBillingMode('per_hour')
  }, [table])

  const canUsePerFrame = Boolean(table?.ratePerFrame)

  // ─── Submit ───────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (submitting) return
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

      const newId = await startSession({
        tableId: tid,
        billingMode,
        rateSnapshot,
        playerName: playerName.trim() || null,
        playerCount: clampedCount,
        note: note.trim() || null,
        framesPlayed: null,
      })

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
          className="flex items-center gap-1 text-text-dim px-1 py-1.5 -ml-1 active:text-text transition-colors"
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
            onChange={(e) => {
              setPlayerName(e.target.value)
              setError(null)
            }}
            placeholder="Enter name…"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
          />
          {recentNames.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2.5">
              {recentNames.map((name) => (
                <button
                  key={name}
                  onClick={() => setPlayerName(name)}
                  className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                    playerName === name
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-bg-elevated border-border text-text-dim'
                  }`}
                >
                  {name}
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
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            className="w-full bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
          />
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
          disabled={submitting}
          className="w-full py-4 bg-accent text-bg rounded-2xl text-[16px] font-bold tracking-tight active:scale-[0.98] disabled:opacity-60 transition-transform"
        >
          {submitting ? 'Starting…' : '▶  Start Timer Now'}
        </button>
      </div>
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
