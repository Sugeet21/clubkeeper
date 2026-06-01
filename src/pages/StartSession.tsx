import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { getActiveSessionForTable, startSession, getRecentPlayerNames } from '../db/queries'
import { validatePlayerName, validateNote, NOTE_MAX } from '../lib/validation'
import { NOTIFY_PRESETS } from '../lib/notifyPresets'
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

  useEffect(() => {
    getRecentPlayerNames().then(setRecentNames)
  }, [])

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
