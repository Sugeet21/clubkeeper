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

// ── #179 Business-day boundary ────────────────────────────────────────────────
// The "business day" starts at `boundaryHour` (0-11), not calendar midnight, so a
// club open past midnight (Sat night → Sun morning) counts one continuous night as
// ONE day. boundaryHour=0 is exactly the old calendar-day behaviour (default).
//
// SINGLE SOURCE OF TRUTH: every "today"/day-range reader (Summary, Home, History,
// useLiveData, queries) MUST go through these two helpers so all screens agree.
// Booking calendars (Bookings.tsx, player/BookingScreen.tsx) deliberately do NOT
// use these — a booking slot is a literal calendar date, not a business day.

/** Clamp any input to a valid boundary hour 0-11 (defensive; UI already limits). */
function normalizeBoundaryHour(hour: number | undefined): number {
  if (typeof hour !== 'number' || !Number.isFinite(hour)) return 0
  return Math.min(11, Math.max(0, Math.floor(hour)))
}

/**
 * The business day (as a calendar Date at 00:00 local) that the given instant
 * belongs to. If the instant's local hour is before `boundaryHour`, it belongs to
 * the PREVIOUS calendar day. Used to LABEL a day and to derive its range.
 */
export function businessDayOf(instant: Date, boundaryHour: number): Date {
  const b = normalizeBoundaryHour(boundaryHour)
  const d = startOfDay(instant)
  if (instant.getHours() < b) d.setDate(d.getDate() - 1)
  return d
}

/**
 * [start, end] epoch-ms for the business day that `date` falls in.
 * start = that day at boundaryHour:00:00.000; end = next day at boundaryHour − 1ms.
 * boundaryHour=0 reproduces startOfDay..endOfDay exactly.
 */
export function businessDayRange(
  date: Date,
  boundaryHour: number,
): { start: number; end: number } {
  const b = normalizeBoundaryHour(boundaryHour)
  const day = businessDayOf(date, b)          // calendar day this instant belongs to
  const start = new Date(day)
  start.setHours(b, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() - 1 }
}
