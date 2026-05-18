import { startOfDay, endOfDay } from 'date-fns'
import type { Session } from '../types'

/**
 * Returns the net active elapsed milliseconds for a session, excluding all
 * paused time. Works for running, paused, and completed sessions.
 *
 * - completed : (endedAt − startedAt) − pausedTotalMs
 *               (pause delta was folded into pausedTotalMs on stop)
 * - paused    : (pausedAt − startedAt) − pausedTotalMs
 *               (clock is frozen at the moment the current pause began)
 * - running   : (now − startedAt) − pausedTotalMs
 */
export function getElapsedMs(session: Session): number {
  if (session.status === 'completed') {
    return Math.max(0, (session.endedAt! - session.startedAt) - session.pausedTotalMs)
  }
  if (session.status === 'paused') {
    return Math.max(0, (session.pausedAt! - session.startedAt) - session.pausedTotalMs)
  }
  return Math.max(0, Date.now() - session.startedAt - session.pausedTotalMs)
}

export function msToHours(ms: number): number {
  return ms / (1000 * 60 * 60)
}

/** Formats a millisecond duration to "1h 23m" or "45m" or "< 1m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  if (totalMinutes < 1) return '< 1m'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Formats milliseconds to zero-padded "HH:MM:SS". */
export function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

export function todayRange(): { start: number; end: number } {
  const now = new Date()
  return {
    start: startOfDay(now).getTime(),
    end: endOfDay(now).getTime(),
  }
}
