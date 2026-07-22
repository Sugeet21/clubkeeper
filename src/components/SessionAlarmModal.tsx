import { useEffect, useState } from 'react'
import { getElapsedMs } from '../lib/time'
import { formatHMS } from '../lib/time'
import { useTick } from '../hooks/useTick'
import { startAlarmLoop, triggerVibration } from '../lib/alarm'
import type { Session } from '../types'

// ─── Snooze options ───────────────────────────────────────────────────────────

const SNOOZE_PRESETS = [
  { label: '5 min', ms: 5 * 60_000 },
  { label: '10 min', ms: 10 * 60_000 },
  { label: '15 min', ms: 15 * 60_000 },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface SessionAlarmModalProps {
  session: Session
  tableName: string
  onStopSession: () => void
  onSnooze: (snoozeMs: number) => void
  soundEnabled: boolean
  vibrationEnabled: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionAlarmModal({
  session,
  tableName,
  onStopSession,
  onSnooze,
  soundEnabled,
  vibrationEnabled,
}: SessionAlarmModalProps) {
  useTick()

  const [showSnooze, setShowSnooze] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  // Start alarm loop on mount; cleanup stops it on unmount or navigation away.
  // Vibration fires once on mount (no loop — battery/annoyance tradeoff).
  // NB (#171): on an owner device this modal only mounts AFTER the silent-backup
  // window has already elapsed (useSessionAlarm withholds the session until
  // then), so when it renders it is meant to be loud. The owner grace logic
  // lives in the hook, not here.
  useEffect(() => {
    if (vibrationEnabled) triggerVibration()
    if (!soundEnabled) return
    return startAlarmLoop()
  }, [soundEnabled, vibrationEnabled])

  const elapsed = getElapsedMs(session)
  const playerLabel = session.playerName ?? 'Walk-in'

  function handleCustomSnooze() {
    const mins = parseInt(customMinutes, 10)
    if (isNaN(mins) || mins < 1 || mins > 120) {
      setCustomError('Enter 1–120 minutes')
      return
    }
    onSnooze(mins * 60_000)
  }

  return (
    // Pattern U8: z-50 to cover bottom nav; no backdrop click / ESC to dismiss
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg"
      style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
    >
      {/* Content — centered vertically */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 gap-5">
        {/* Bell icon */}
        <div className="w-20 h-20 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center">
          <span className="text-4xl" role="img" aria-label="alarm bell">🔔</span>
        </div>

        {/* Headline */}
        <div className="text-center">
          <p className="text-[13px] font-mono uppercase tracking-widest text-accent mb-1">
            Time Alert
          </p>
          <p className="text-[22px] font-bold text-text leading-snug">{tableName}</p>
          <p className="text-[15px] text-text-dim mt-1">{playerLabel}</p>
        </div>

        {/* Elapsed time */}
        <div className="bg-bg-card border border-border rounded-2xl px-8 py-4 text-center">
          <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-1">
            Running for
          </p>
          <p className="text-[32px] font-bold font-mono text-text tracking-tight">
            {formatHMS(elapsed)}
          </p>
        </div>

        {/* Snooze picker */}
        {showSnooze && (
          <div className="w-full">
            <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-2 text-center">
              Snooze for
            </p>
            <div className="flex gap-2 justify-center flex-wrap">
              {SNOOZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => onSnooze(p.ms)}
                  className="min-h-[44px] px-4 rounded-xl bg-bg-elevated border border-border text-text text-[14px] font-semibold active:bg-bg-card transition-colors"
                >
                  {p.label}
                </button>
              ))}
              {/* Custom chip */}
              <div className="flex items-center gap-2 bg-bg-elevated border border-border rounded-xl px-3 min-h-[44px]">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  value={customMinutes}
                  onChange={(e) => { setCustomMinutes(e.target.value); setCustomError(null) }}
                  placeholder="min"
                  className="w-14 bg-transparent text-text text-[14px] text-center focus:outline-none placeholder-text-faint"
                />
                <button
                  onClick={handleCustomSnooze}
                  className="text-[13px] font-semibold text-accent min-h-[44px]"
                >
                  Go
                </button>
              </div>
            </div>
            {customError && (
              <p className="text-busy text-[12px] mt-1.5 text-center">{customError}</p>
            )}
          </div>
        )}
      </div>

      {/* Footer buttons — always visible */}
      <div
        className="px-5 pt-3 space-y-3 shrink-0"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onStopSession}
          className="w-full min-h-[52px] bg-accent text-bg rounded-2xl text-[16px] font-bold active:scale-[0.98] transition-transform"
        >
          Stop session
        </button>
        <button
          onClick={() => setShowSnooze((s) => !s)}
          className="w-full min-h-[52px] bg-bg-card border border-border text-text rounded-2xl text-[16px] font-semibold active:scale-[0.98] transition-transform"
        >
          {showSnooze ? 'Hide snooze ↑' : 'Snooze ⏱'}
        </button>
      </div>
    </div>
  )
}
