import { useState, useMemo, useRef } from 'react'
import { format, isToday, isYesterday, startOfDay, endOfDay } from 'date-fns'
import { useSessionsInRange, useTables, useSettings } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatDuration } from '../lib/time'
import { calculateAmount } from '../lib/money'
import type { GameType, GameTable, Session } from '../types'

// ─── Icons ────────────────────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 8h16" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 2v4M14 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateSubtitle(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'd MMM yyyy')
}

function tableAbbr(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return name.slice(0, 2).toUpperCase()
  const abbr = words[0][0].toUpperCase() + words[words.length - 1]
  return abbr.slice(0, 3)
}

function gameTypeBadgeClass(type: GameType | undefined): string {
  switch (type) {
    case 'pool':        return 'bg-free/15 text-free'
    case 'snooker':     return 'bg-accent/15 text-accent-dim'
    case 'carrom':      return 'bg-paused/20 text-paused'
    case 'playstation': return 'bg-busy/15 text-busy'
    default:            return 'bg-bg-elevated text-text-dim'
  }
}

/** Table-time-only amount (live for running sessions, stored for completed). */
function sessionBaseAmount(s: Session): number {
  if (s.status === 'completed') return s.amount
  return calculateAmount(s.billingMode, getElapsedMs(s), s.rateSnapshot, s.framesPlayed)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  small = false,
}: {
  label: string
  value: string
  small?: boolean
}) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl p-3">
      <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
        {label}
      </p>
      <p className={`font-bold text-text leading-tight ${small ? 'text-[13px]' : 'text-[18px]'}`}>
        {value}
      </p>
    </div>
  )
}

function SessionRow({
  session,
  table,
  currency,
  displayAmount,
}: {
  session: Session
  table: GameTable | undefined
  currency: string
  displayAmount: number
}) {
  const elapsed = getElapsedMs(session)
  const abbr = table ? tableAbbr(table.name) : '?'
  const badgeClass = gameTypeBadgeClass(table?.gameType)

  const playerLabel = session.playerName
    ? session.playerCount > 1
      ? `${session.playerName} +${session.playerCount - 1}`
      : session.playerName
    : `${session.playerCount} player${session.playerCount !== 1 ? 's' : ''}`

  const startStr = format(session.startedAt, 'h:mm a')
  const endStr =
    session.status === 'completed'
      ? format(session.endedAt!, 'h:mm a')
      : session.status === 'running'
      ? 'Running'
      : 'Paused'

  // Show rounded duration when applicable
  let durationLabel: string
  if (session.billingMode === 'per_frame') {
    durationLabel = `${session.framesPlayed ?? 0} frame${(session.framesPlayed ?? 0) !== 1 ? 's' : ''}`
  } else if (session.status === 'completed' && session.roundedDurationMs) {
    durationLabel = `${formatDuration(session.roundedDurationMs)} (rounded)`
  } else {
    durationLabel = formatDuration(elapsed)
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-0">
      {/* Badge */}
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-[12px] shrink-0 ${badgeClass}`}
      >
        {abbr}
      </div>

      {/* Middle */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-text leading-tight truncate">{playerLabel}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {session.status === 'running' && (
            <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse shrink-0" />
          )}
          {session.status === 'paused' && (
            <span className="w-1.5 h-1.5 rounded-full bg-paused shrink-0" />
          )}
          <p className="text-[11px] text-text-faint font-mono">
            {startStr} — {endStr}
          </p>
        </div>
      </div>

      {/* Right */}
      <div className="text-right shrink-0">
        <p className="text-[15px] font-bold text-text tabular-nums">
          {currency}{displayAmount.toLocaleString('en-IN')}
        </p>
        <p className="text-[11px] text-text-faint font-mono mt-0.5 tabular-nums">
          {durationLabel}
        </p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Summary() {
  const tables = useTables()
  const settings = useSettings()
  const currency = settings?.currency ?? '₹'

  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const dateInputRef = useRef<HTMLInputElement>(null)

  useTick() // keeps running-session amounts live

  const startMs = startOfDay(selectedDate).getTime()
  const endMs = endOfDay(selectedDate).getTime()
  const rows = useSessionsInRange(startMs, endMs)

  // Table lookup map
  const tableMap = useMemo(() => {
    const m = new Map<number, GameTable>()
    for (const t of tables) if (t.id !== undefined) m.set(t.id, t)
    return m
  }, [tables])

  // Sorted rows
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.session.startedAt - a.session.startedAt),
    [rows],
  )

  // ── Aggregate stats ─────────────────────────────────────────────────────

  let totalRevenue = 0
  let totalElapsedMs = 0
  const tableCounts = new Map<number, number>()

  for (const { session, items } of rows) {
    const e = getElapsedMs(session)
    const base = sessionBaseAmount(session)
    const itemsTotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
    totalRevenue += base + itemsTotal
    totalElapsedMs += e
    tableCounts.set(session.tableId, (tableCounts.get(session.tableId) ?? 0) + 1)
  }

  let busiestTableId: number | undefined
  let maxCount = 0
  for (const [id, count] of tableCounts) {
    if (count > maxCount) {
      maxCount = count
      busiestTableId = id
    }
  }
  const busiestTable = busiestTableId !== undefined ? tableMap.get(busiestTableId) : undefined

  // ── Export CSV ────────────────────────────────────────────────────────────

  function handleExport() {
    const headers = ['Table', 'Player', 'Players', 'Start', 'End', 'Duration (min)', `Table Amount (${currency})`, `Items (${currency})`, `Total (${currency})`, 'Billing', 'Frames']
    const exportRows = [...rows]
      .sort((a, b) => a.session.startedAt - b.session.startedAt)
      .map(({ session: s, items }) => {
        const t = tableMap.get(s.tableId)
        const e = getElapsedMs(s)
        const tableAmt = sessionBaseAmount(s)
        const itemsAmt = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
        return [
          t?.name ?? `Table ${s.tableId}`,
          s.playerName ?? '',
          s.playerCount,
          format(s.startedAt, 'yyyy-MM-dd HH:mm:ss'),
          s.endedAt ? format(s.endedAt, 'yyyy-MM-dd HH:mm:ss') : 'Running',
          Math.floor(e / 60_000),
          tableAmt,
          itemsAmt,
          tableAmt + itemsAmt,
          s.billingMode,
          s.framesPlayed ?? 0,
        ]
      })

    const csv = [headers, ...exportRows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clubkeeper-${format(selectedDate, 'yyyy-MM-dd')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Date picker change ────────────────────────────────────────────────────

  function handleDateChange(value: string) {
    if (!value) return
    const [y, m, d] = value.split('-').map(Number)
    setSelectedDate(new Date(y, (m as number) - 1, d as number))
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Top bar */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-text leading-tight">Summary</h1>
          <p className="text-[12px] text-text-dim font-mono mt-0.5">
            End of day · {dateSubtitle(selectedDate)}
          </p>
        </div>
        {/* Hidden date input + visible calendar button */}
        <div className="relative w-9 h-9 mt-0.5">
          <button className="w-full h-full flex items-center justify-center rounded-xl text-text-dim hover:text-text hover:bg-bg-elevated transition-colors">
            <CalendarIcon />
          </button>
          <input
            ref={dateInputRef}
            type="date"
            value={format(selectedDate, 'yyyy-MM-dd')}
            max={format(new Date(), 'yyyy-MM-dd')}
            onChange={(e) => handleDateChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Hero */}
      <div className="px-4 pt-2 pb-6 border-b border-border">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
          {format(selectedDate, 'EEEE · d MMM yyyy')}
        </p>
        <p className="text-[14px] font-semibold text-text-dim mb-2">Day's Earnings</p>
        <div className="flex items-baseline gap-0.5">
          <span className="text-[24px] font-bold font-mono text-text-faint">{currency}</span>
          <span className="text-[36px] font-bold font-mono tracking-tight text-accent tabular-nums">
            {totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </span>
        </div>
        <p className="text-[11px] text-text-faint mt-1.5">Calculated — not collected</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 px-4 py-4 border-b border-border">
        <StatCard label="Sessions" value={String(rows.length)} />
        <StatCard label="Time Played" value={rows.length > 0 ? formatDuration(totalElapsedMs) : '—'} />
        <StatCard label="Busiest" value={busiestTable?.name ?? '—'} small />
      </div>

      {/* Session list */}
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Today's Sessions
          </p>
          {rows.length > 0 && (
            <button
              onClick={handleExport}
              className="text-[12px] text-accent font-semibold hover:text-accent-dim transition-colors"
            >
              Export ↓
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-faint text-[14px]">No sessions recorded</p>
            <p className="text-text-faint/60 text-[12px] mt-1">for {dateSubtitle(selectedDate).toLowerCase()}</p>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {sortedRows.map(({ session, items }) => {
              const base = sessionBaseAmount(session)
              const itemsAmt = items.reduce((s, i) => s + i.price * i.quantity, 0)
              return (
                <SessionRow
                  key={session.id}
                  session={session}
                  table={tableMap.get(session.tableId)}
                  currency={currency}
                  displayAmount={base + itemsAmt}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
