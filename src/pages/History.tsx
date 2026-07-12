import { useState, useMemo } from 'react'
import { format, subDays, startOfDay, endOfDay, isToday, isYesterday } from 'date-fns'
import { useSessionsInRange, useTables, useSettings } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatDuration } from '../lib/time'
import { calculateAmount } from '../lib/money'
import { BackEntryModal } from '../components/BackEntryModal'
import { useRole } from '../hooks/useRole'
import type { GameType, GameTable, Session } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tableAbbr(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return name.slice(0, 2).toUpperCase()
  return (words[0][0].toUpperCase() + words[words.length - 1]).slice(0, 3)
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

function sessionBaseAmt(s: Session): number {
  if (s.status === 'completed') return s.amount
  return calculateAmount(s, getElapsedMs(s))
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMM yyyy')
}

// ─── Session row ──────────────────────────────────────────────────────────────

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
    ? session.playerCount > 1 ? `${session.playerName} +${session.playerCount - 1}` : session.playerName
    : `${session.playerCount} player${session.playerCount !== 1 ? 's' : ''}`

  const startStr = format(session.startedAt, 'h:mm a')
  const endStr =
    session.status === 'completed' ? format(session.endedAt!, 'h:mm a') :
    session.status === 'running' ? 'Running' : 'Paused'

  // Show rounded duration when available
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
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-[12px] shrink-0 ${badgeClass}`}>
        {abbr}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-text truncate">{playerLabel}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {session.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse shrink-0" />}
          {session.status === 'paused' && <span className="w-1.5 h-1.5 rounded-full bg-paused shrink-0" />}
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-[11px] text-text-faint font-mono">
              {startStr} — {endStr}
              {(session.tableMoves?.length ?? 0) > 0 && (
                <span className="ml-1.5">· ↻ {session.tableMoves!.length + 1} tables</span>
              )}
            </p>
            {session.isBackEntry && (
              <span className="text-[10px] uppercase tracking-widest text-text-faint border border-border rounded-md px-1.5 py-0.5">
                Logged
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[15px] font-bold text-text tabular-nums">{currency}{displayAmount.toLocaleString('en-IN')}</p>
        <p className="text-[11px] text-text-faint font-mono mt-0.5">{durationLabel}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Phase D (D5) — role split (Pattern A12; owner answer 10 Jul amends the §2
// matrix): the past-session list, filters, revenue figures, and CSV export are
// owner-only, but staff MUST keep back-entry creation. Whole-component branch
// (same shape as the D4 Settings split) keeps the Rules of Hooks happy and the
// owner render byte-identical.
export default function History() {
  const role = useRole()
  if (role === 'staff') return <StaffHistoryView />
  return <OwnerHistory />
}

// Staff view: ONLY the "Log past session" card — no session list, no revenue.
// BackEntryModal is fully functional (staff RLS allows sessions/session_items
// INSERT + canteen stock UPDATE, exactly what a back entry writes).
function StaffHistoryView() {
  const [showBackEntry, setShowBackEntry] = useState(false)

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-[22px] font-bold tracking-tight text-text">History</h1>
      </div>

      <div className="px-4">
        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <p className="text-[15px] font-semibold text-text">Log a past session</p>
          <p className="text-[13px] text-text-dim mt-1 leading-snug">
            Forgot to start the timer? Add the session from the paper notebook here.
          </p>
          <button
            onClick={() => setShowBackEntry(true)}
            className="mt-4 w-full min-h-[48px] bg-accent text-bg font-bold rounded-2xl text-[15px] active:scale-[0.99] transition-transform"
          >
            + Log past session
          </button>
        </div>
      </div>

      <BackEntryModal
        open={showBackEntry}
        onClose={() => setShowBackEntry(false)}
        onSaved={() => setShowBackEntry(false)}
      />
    </div>
  )
}

function OwnerHistory() {
  const tables = useTables()
  const settings = useSettings()
  const currency = settings?.currency ?? '₹'

  // Store as YYYY-MM-DD strings to match <input type="date"> format
  const [fromStr, setFromStr] = useState(() => format(subDays(new Date(), 6), 'yyyy-MM-dd'))
  const [toStr, setToStr] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  // Post-v20 ID law (Pattern R5): table ids are UUID strings; was `number` +
  // Number(uuid)=NaN so the filter dropdown never matched (#134 sibling).
  const [filterTableId, setFilterTableId] = useState<string | 'all'>('all')
  const [showBackEntry, setShowBackEntry] = useState(false)

  useTick()

  function parseLocalDate(str: string): Date {
    const [y, m, d] = str.split('-').map(Number)
    return new Date(y, (m as number) - 1, d as number)
  }

  function handleFromChange(value: string) {
    if (!value) return
    if (toStr && value > toStr) { setFromStr(toStr); setToStr(value) }
    else setFromStr(value)
  }

  function handleToChange(value: string) {
    if (!value) return
    if (fromStr && value < fromStr) { setToStr(fromStr); setFromStr(value) }
    else setToStr(value)
  }

  const rangeStart = startOfDay(parseLocalDate(fromStr)).getTime()
  const rangeEnd = endOfDay(parseLocalDate(toStr)).getTime()

  // Single live query — sessions + their items in one shot, no N+1
  const rows = useSessionsInRange(rangeStart, rangeEnd)

  const tableMap = useMemo(() => {
    const m = new Map<string, GameTable>() // Pattern R5: table ids are UUID strings (#134 sibling)
    for (const t of tables) if (t.id !== undefined) m.set(t.id, t)
    return m
  }, [tables])

  const filteredRows = filterTableId === 'all'
    ? rows
    : rows.filter((r) => r.session.tableId === filterTableId)

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filteredRows>()
    for (const r of filteredRows) {
      const key = format(r.session.startedAt, 'yyyy-MM-dd')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    for (const [, arr] of map) arr.sort((a, b) => b.session.startedAt - a.session.startedAt)
    return map
  }, [filteredRows])

  const sortedDays = useMemo(
    () => [...grouped.keys()].sort((a, b) => b.localeCompare(a)),
    [grouped],
  )

  // ── Export ──────────────────────────────────────────────────────────────
  // CSV choice: keep existing Amount column as table-time, add Items + Total columns.

  function handleExport() {
    const headers = ['Table', 'Player', 'Players', 'Date', 'Start', 'End', 'Duration (min)', `Table Amount (${currency})`, `Items (${currency})`, `Total (${currency})`, 'Billing', 'Frames']
    const exportRows = [...filteredRows].sort((a, b) => a.session.startedAt - b.session.startedAt).map(({ session: s, items }) => {
      const t = tableMap.get(s.tableId)
      const e = getElapsedMs(s)
      const tableAmt = sessionBaseAmt(s)
      const itemsAmt = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
      return [
        t?.name ?? `Table ${s.tableId}`,
        s.playerName ?? '',
        s.playerCount,
        format(s.startedAt, 'yyyy-MM-dd'),
        format(s.startedAt, 'HH:mm:ss'),
        s.endedAt ? format(s.endedAt, 'HH:mm:ss') : 'Running',
        Math.floor((s.roundedDurationMs ?? e) / 60_000),
        tableAmt,
        itemsAmt,
        tableAmt + itemsAmt,
        s.billingMode,
        s.framesPlayed ?? 0,
      ]
    })
    const csv = [headers, ...exportRows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clubkeeper-${fromStr}-to-${toStr}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Top bar */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight text-text">History</h1>
          <p className="text-[12px] text-text-dim font-mono mt-0.5">
            {format(parseLocalDate(fromStr), 'd MMM')} — {format(parseLocalDate(toStr), 'd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowBackEntry(true)}
            className="bg-bg-card border border-border text-accent font-semibold rounded-2xl px-4 py-2 text-sm min-h-[44px]"
          >
            + Log past session
          </button>
          {filteredRows.length > 0 && (
            <button onClick={handleExport} className="text-[13px] text-accent font-semibold min-h-[44px]">
              Export ↓
            </button>
          )}
        </div>
      </div>

      <BackEntryModal
        open={showBackEntry}
        onClose={() => setShowBackEntry(false)}
        onSaved={(dateISO) => {
          setFromStr(dateISO)
          setToStr(dateISO)
          setShowBackEntry(false)
        }}
      />

      {/* Date inputs */}
      <div className="px-4 mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
            From
          </label>
          <input
            type="date"
            value={fromStr}
            max={today}
            onChange={(e) => handleFromChange(e.target.value)}
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text font-mono text-sm focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
            To
          </label>
          <input
            type="date"
            value={toStr}
            max={today}
            onChange={(e) => handleToChange(e.target.value)}
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text font-mono text-sm focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
          />
        </div>
      </div>

      {/* Table filter */}
      {tables.length > 1 && (
        <div className="px-4 mb-4">
          <select
            value={filterTableId === 'all' ? '' : filterTableId}
            onChange={(e) => setFilterTableId(e.target.value || 'all')}
            className="w-full bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-text text-[14px] focus:outline-none [color-scheme:dark]"
          >
            <option value="">All Tables</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Content */}
      <div className="px-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-faint text-[14px]">No sessions in this range</p>
          </div>
        ) : sortedDays.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-text-faint text-[14px]">No sessions for selected table</p>
          </div>
        ) : (
          sortedDays.map((dayKey) => {
            const dayRows = grouped.get(dayKey)!
            const dayDate = new Date(dayKey + 'T00:00:00')

            // Grand total for the day = table-time + items for all sessions
            const dayGrandTotal = dayRows.reduce((sum, { session, items }) => {
              const base = sessionBaseAmt(session)
              const itemsAmt = items.reduce((s, i) => s + i.price * i.quantity, 0)
              return sum + base + itemsAmt
            }, 0)

            return (
              <div key={dayKey} className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] font-semibold text-text">{dayLabel(dayDate)}</p>
                  <p className="text-[14px] font-bold text-accent tabular-nums">
                    {currency}{dayGrandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
                  {dayRows.map(({ session, items }) => {
                    const base = sessionBaseAmt(session)
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
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
