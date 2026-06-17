import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import TopBar from '../components/TopBar'
import { useAuthStore } from '../store/authStore'
import { useBookingInbox } from '../store/bookingInbox'
import { useSettings } from '../hooks/useLiveData'
import { getOwnerClub, getPendingBookings } from '../lib/playerHubApi'
import type { PendingBookingRow } from '../lib/playerHubApi'
import PendingBookingsModal from '../components/PendingBookingsModal'
import type { Booking } from '../types/booking'

// /bookings — owner agenda page.
//
// Pattern T4: the Dexie query in useLiveQuery is DB-STATIC (just pulls every
// confirmed/consumed booking for the next 7 days). Anything that depends on
// `Date.now()` — "is this slot in progress now?" — is recomputed in the render
// body. Never put `Date.now()` inside the useLiveQuery dep array; that would
// re-fire the query every render and tank performance with a few hundred
// bookings.

const DAYS_AHEAD = 7
const GAME_LABELS: Record<string, string> = {
  pool: 'Pool',
  snooker: 'Snooker',
  carrom: 'Carrom',
  playstation: 'PlayStation',
  other: 'Other',
}

function startOfLocalDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function endOfLocalDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(23, 59, 59, 999)
  return c
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDayHeader(d: Date, isToday: boolean): string {
  if (isToday) return `Today · ${d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}`
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Bookings() {
  const navigate = useNavigate()
  const { dbReady, session } = useAuthStore()
  const { openModal } = useBookingInbox()
  const settings = useSettings()

  const [pendingIntents, setPendingIntents] = useState<PendingBookingRow[]>([])
  const [clubId, setClubId] = useState<string | null>(null)

  // Live query — DB-static (no Date.now() in deps). The 7-day window endpoints
  // are computed once on mount and refreshed via the rerender on clubId set.
  // For a per-page agenda this is sufficient; users navigating back/forth
  // re-mount the page which re-anchors the window.
  const windowMs = useMemo(() => {
    const now = new Date()
    const start = startOfLocalDay(now).getTime()
    const end = endOfLocalDay(new Date(now.getTime() + (DAYS_AHEAD - 1) * 86_400_000)).getTime()
    return { start, end }
  }, [])

  const bookings = useLiveQuery<Booking[]>(
    () =>
      db.bookings
        .where('slotStart')
        .between(windowMs.start, windowMs.end, true, true)
        .toArray(),
    [windowMs.start, windowMs.end],
    [],
  )

  const tables = useLiveQuery(
    () => db.gameTables.orderBy('sortOrder').toArray(),
    [],
    [],
  )

  // Initial pending intents + clubId so the modal can render. Realtime channel
  // is owned by <BookingRealtimeBridge /> in App.tsx — this page only refreshes
  // the modal list on store changes.
  const pendingCount = useBookingInbox((s) => s.pendingCount)
  useEffect(() => {
    if (!dbReady || !session) return
    let cancelled = false
    void (async () => {
      try {
        const club = await getOwnerClub()
        if (cancelled || !club) return
        setClubId(club.id)
        const intents = await getPendingBookings(club.id)
        if (!cancelled) setPendingIntents(intents)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [dbReady, session])

  useEffect(() => {
    if (!clubId) return
    getPendingBookings(clubId)
      .then((rows) => setPendingIntents(rows))
      .catch(() => {})
  }, [pendingCount, clubId])

  // ── Group bookings by day, then by tableId ───────────────────────────────
  const days = useMemo(() => {
    const out: { date: Date; isToday: boolean }[] = []
    const today = startOfLocalDay(new Date())
    for (let i = 0; i < DAYS_AHEAD; i += 1) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      out.push({ date: d, isToday: i === 0 })
    }
    return out
  }, [])

  const tableNameById = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of tables ?? []) {
      if (t.id !== undefined) m.set(t.id, t.name)
    }
    return m
  }, [tables])

  const bookingsByDay = useMemo(() => {
    const byDay = new Map<number, Booking[]>()
    for (const b of bookings ?? []) {
      const dayStart = startOfLocalDay(new Date(b.slotStart)).getTime()
      const arr = byDay.get(dayStart) ?? []
      arr.push(b)
      byDay.set(dayStart, arr)
    }
    // Sort each day's bookings by start time
    for (const [k, v] of byDay) {
      v.sort((a, b) => a.slotStart - b.slotStart)
      byDay.set(k, v)
    }
    return byDay
  }, [bookings])

  // Current-time-derived render data (NOT memo'd against time — recomputed each render)
  const now = Date.now()

  const acceptsBookings = settings?.acceptsBookings ?? false
  const advance = settings?.bookingAdvanceAmount ?? 100

  function statusLabel(b: Booking, nowMs: number): { label: string; cls: string } {
    if (b.status === 'cancelled') return { label: 'Cancelled', cls: 'text-text-faint' }
    if (b.status === 'no_show') return { label: 'No-show', cls: 'text-busy' }
    if (b.status === 'consumed') return { label: 'Played', cls: 'text-free' }
    // confirmed
    if (b.slotStart > nowMs) return { label: 'Upcoming', cls: 'text-accent' }
    if (b.slotEnd > nowMs) return { label: 'Now', cls: 'text-amber-400 font-bold' }
    return { label: 'Missed', cls: 'text-busy' }   // confirmed but slot past, never consumed
  }

  return (
    <div className="min-h-screen bg-bg pb-20">
      <div className="max-w-md mx-auto px-4">
        <TopBar />

        {/* Header + pending pill */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-text">Bookings</h1>
            <p className="text-text-faint text-[12px] mt-0.5">Next {DAYS_AHEAD} days</p>
          </div>
          {acceptsBookings && (
            <button
              onClick={openModal}
              className={`min-h-[44px] px-3 rounded-xl text-[13px] font-bold border ${
                pendingCount > 0
                  ? 'bg-amber-500/12 text-amber-400 border-amber-500/30'
                  : 'bg-bg-card text-text-dim border-border'
              }`}
            >
              {pendingCount > 0
                ? `${pendingCount} pending · Review`
                : 'No pending'}
            </button>
          )}
        </div>

        {!acceptsBookings && (
          <div className="mt-4 bg-bg-card border border-border rounded-2xl px-4 py-4">
            <p className="text-text font-semibold text-[14px]">Bookings are turned off</p>
            <p className="text-text-dim text-[13px] mt-1">
              Enable "Accept bookings" in Settings → Player Hub to start receiving advance
              bookings from players (advance: ₹{advance.toLocaleString('en-IN')}).
            </p>
            <button
              onClick={() => navigate('/settings')}
              className="mt-3 min-h-[44px] px-4 bg-accent text-bg rounded-xl text-[13px] font-bold"
            >
              Open settings
            </button>
          </div>
        )}

        {/* Agenda — one block per day */}
        <div className="mt-4 flex flex-col gap-4">
          {days.map(({ date, isToday }) => {
            const dayKey = date.getTime()
            const list = bookingsByDay.get(dayKey) ?? []
            return (
              <div key={dayKey} className="bg-bg-card border border-border rounded-2xl px-4 py-3">
                <p className="text-text-faint text-[11px] font-mono uppercase tracking-widest">
                  {formatDayHeader(date, isToday)}
                </p>
                {list.length === 0 ? (
                  <p className="text-text-faint text-[13px] mt-2">No bookings</p>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {list.map((b) => {
                      const status = statusLabel(b, now)
                      const tableName = tableNameById.get(b.tableId) ?? `Table #${b.tableId}`
                      return (
                        <div
                          key={b.id}
                          className="bg-bg border border-border rounded-xl px-3 py-2.5"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-text font-semibold text-[14px]">{tableName}</p>
                            <p className={`text-[11px] font-mono uppercase tracking-widest ${status.cls}`}>
                              {status.label}
                            </p>
                          </div>
                          <p className="text-text-dim text-[13px] font-mono mt-0.5">
                            {formatTime(b.slotStart)} – {formatTime(b.slotEnd)} · {b.durationMin} min
                          </p>
                          <p className="text-text-faint text-[12px] mt-1">
                            {b.playerName?.trim() || '(no name)'} · {b.playerPhone}
                          </p>
                          <p className="text-text-faint text-[11px] mt-0.5">
                            {GAME_LABELS[b.gameType] ?? b.gameType} · advance ₹{b.advanceAmount.toLocaleString('en-IN')}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {clubId && (
        <PendingBookingsModal
          intents={pendingIntents}
          onIntentHandled={(intentId) => {
            setPendingIntents((prev) => prev.filter((i) => i.id !== intentId))
          }}
        />
      )}
    </div>
  )
}
