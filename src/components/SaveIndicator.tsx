import { useEffect, useRef, useState, useCallback } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SaveIndicatorProps {
  state: SaveState
  error?: string | null
  className?: string
}

/**
 * Pattern U9 — Save actions must show visible state.
 * Renders nothing when idle. Spinner when saving. Green check + "Saved" when saved.
 * Red text on error. The parent auto-resets to idle (see useSaveIndicator hook).
 */
export function SaveIndicator({ state, error, className }: SaveIndicatorProps) {
  if (state === 'idle') return null

  const base = `inline-flex items-center gap-1 text-[12px] font-mono ${className ?? ''}`

  if (state === 'saving') {
    return (
      <span className={`${base} text-text-faint`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
          <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
        </svg>
        Saving…
      </span>
    )
  }

  if (state === 'saved') {
    return (
      <span className={`${base} text-free`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Saved
      </span>
    )
  }

  return (
    <span className={`${base} text-busy`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {error ?? 'Failed'}
    </span>
  )
}

interface UseSaveIndicatorReturn {
  state: SaveState
  error: string | null
  run: (fn: () => Promise<void>) => Promise<void>
}

/**
 * Wraps an async save fn with state machine: idle → saving → saved (1.5s) → idle,
 * or idle → saving → error. Use with <SaveIndicator state={state} error={error} />.
 */
export function useSaveIndicator(): UseSaveIndicatorReturn {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }
    setState('saving')
    setError(null)
    try {
      await fn()
      setState('saved')
      resetTimer.current = setTimeout(() => {
        setState('idle')
        resetTimer.current = null
      }, 1500)
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [])

  return { state, error, run }
}
