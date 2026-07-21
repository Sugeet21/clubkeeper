import { useState, useMemo, useId } from 'react'
import {
  format,
  isToday,
  isYesterday,
  startOfDay,
  endOfDay,
  subDays,
} from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { getCanteenItems, getLowStockThreshold, getPiggyBalance } from '../db/queries'
import { useTables, useActiveSessions, useSettings } from '../hooks/useLiveData'
import { useRole } from '../hooks/useRole'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatDuration } from '../lib/time'
import { calculateAmount, calculateItemsTotal } from '../lib/money'
import {
  computeDelta,
  bucketByHour,
  rankTables,
  topCanteenItems,
} from '../lib/summaryMath'
import type { GameTable, Session, SessionItem } from '../types'
import type { GameType } from '../types'

// Sub-components
import RevenueDeltas from './summary/RevenueDeltas'
import RevenueSplitBar from './summary/RevenueSplitBar'
import HourlyHeatmap from './summary/HourlyHeatmap'
import TopTablesList from './summary/TopTablesList'
import LowStockStrip from './summary/LowStockStrip'
import TopCanteenItems from './summary/TopCanteenItems'
import PaymentModeStrip from './summary/PaymentModeStrip'
import CashFlowStrip from './summary/CashFlowStrip'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
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

// ─── Summary header with inline date picker ───────────────────────────────────

function SummaryHeader({ viewedDate, onChange, todayISO, onExport }: {
  viewedDate: Date;
  onChange: (d: Date) => void;
  todayISO: string;
  onExport?: () => void;
}) {
  const inputId = useId();
  const isoValue = format(viewedDate, 'yyyy-MM-dd');

  const subtitleDate = isToday(viewedDate)
    ? 'Today'
    : isYesterday(viewedDate)
    ? 'Yesterday'
    : format(viewedDate, 'd MMM yyyy');

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold text-text">Summary</h1>
        <p className="text-[13px] font-mono text-text-dim mt-1">
          End of day · {subtitleDate}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Calendar icon — label wraps an opacity-0 input positioned over it */}
        <div className="relative w-11 h-11">
          <label
            htmlFor={inputId}
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-bg-card border border-border cursor-pointer text-text-dim hover:text-text"
            aria-label="Pick a date"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
            </svg>
          </label>
          <input
            id={inputId}
            type="date"
            value={isoValue}
            max={todayISO}
            onChange={(e) => {
              if (!e.target.value) return;
              const [y, m, d] = e.target.value.split('-').map(Number);
              onChange(new Date(y, m - 1, d));
            }}
            aria-label="Pick a date"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
          />
        </div>

        {/* Export button */}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="text-[12px] text-accent font-semibold hover:text-accent-dim transition-colors min-h-[44px] flex items-center"
          >
            Export ↓
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Session row (unchanged behavior) ────────────────────────────────────────

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

  let durationLabel: string
  if (session.billingMode === 'per_frame') {
    durationLabel = `${session.framesPlayed ?? 0} frame${(session.framesPlayed ?? 0) !== 1 ? 's' : ''}`
  } else if (session.status === 'completed' && session.roundedDurationMs) {
    durationLabel = `${formatDuration(session.roundedDurationMs)} (rounded)`
  } else {
    durationLabel = formatDuration(elapsed)
  }

  // Table journey subtitle
  const journeyStr =
    session.tableMoves && session.tableMoves.length > 0
      ? `↻ ${session.tableMoves.length} table${session.tableMoves.length !== 1 ? 's' : ''}`
      : null

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-0">
      <div
        className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-[12px] shrink-0 ${badgeClass}`}
      >
        {abbr}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-text leading-tight truncate">{playerLabel}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {session.status === 'running' && (
            <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse shrink-0" />
          )}
          {session.status === 'paused' && (
            <span className="w-1.5 h-1.5 rounded-full bg-paused shrink-0" />
          )}
          <p className="text-[11px] text-text-faint font-mono truncate">
            {startStr} — {endStr}
            {journeyStr && (
              <span className="ml-1.5 text-text-faint/70">{journeyStr}</span>
            )}
          </p>
        </div>
      </div>

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

// Phase D (D7) — role split (Pattern A12, same shape as the D5 History split).
// Staff get ONLY the today-card: no date picker, no deltas, no heatmap, no
// piggy/cash-flow strip, no export. Whole-component branch keeps the Rules of
// Hooks happy and the owner render byte-identical.
export default function Summary() {
  const role = useRole()
  if (role === 'staff') return <StaffSummaryToday />
  return <OwnerSummary />
}

// Staff view: one card — today's earnings, session count, canteen sales count.
// The revenue formula MIRRORS OwnerSummary's headline (do not fork the math):
// completed session amounts + non-deleted session items (#124) + live running
// amounts recomputed per tick in the render body (Pattern T4) + walk-in Quick
// Sale totals (Pattern T9). Home's today-strip is NOT the reference — it
// omits walk-in sales.
function StaffSummaryToday() {
  const activeSessions = useActiveSessions()

  useTick() // drives the live running-session portion every second

  // Day key as the query dep so the static totals re-fire at midnight
  // (useTick re-renders make the key flip without a remount).
  const dayKey = todayISO()

  const todayStatic = useLiveQuery(
    async () => {
      const start = startOfDay(new Date()).getTime()
      const end = endOfDay(new Date()).getTime()
      const sessions = await db.sessions
        .where('startedAt')
        .between(start, end, true, true)
        .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded
        .toArray()

      const sessionIds = sessions.map((s) => s.id!).filter(Boolean)
      const items = sessionIds.length
        ? await db.sessionItems
            .where('sessionId')
            .anyOf(sessionIds)
            .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
            .toArray()
        : []

      const completedRevenue = sessions
        .filter((s) => s.status === 'completed')
        .reduce((sum, s) => sum + s.amount, 0)
      const itemsRevenue = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

      const canteenSales = await db.canteenSales
        .where('createdAt')
        .between(start, end, true, true)
        .filter((c) => !c.deletedAt) // #166 — reversed walk-in sales leave revenue
        .toArray()
      const walkInRevenue = canteenSales.reduce((sum, s) => sum + s.total, 0)

      return {
        completedRevenue,
        itemsRevenue,
        walkInRevenue,
        sessionCount: sessions.length,
        saleCount: canteenSales.length,
      }
    },
    [dayKey],
  )

  // Pattern T4 — live portion in the render body, never useMemo.
  const todayStart = startOfDay(new Date()).getTime()
  const runningRevenue = activeSessions
    .filter((s) => s.startedAt >= todayStart)
    .reduce((sum, s) => sum + calculateAmount(s, getElapsedMs(s)), 0)

  const totalRevenue =
    (todayStatic?.completedRevenue ?? 0) +
    (todayStatic?.itemsRevenue ?? 0) +
    (todayStatic?.walkInRevenue ?? 0) +
    runningRevenue

  const sessionCount = todayStatic?.sessionCount ?? 0
  const saleCount = todayStatic?.saleCount ?? 0

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">
      <div className="px-5 pt-4 pb-3">
        <h1 className="text-2xl font-bold text-text">Summary</h1>
        <p className="text-[13px] font-mono text-text-dim mt-1">Today</p>
      </div>

      <div className="px-5 pt-4">
        <div className="bg-bg-card border border-border rounded-2xl p-5">
          <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-1">
            Day's earnings
          </p>
          {/* formatINR unconditionally — mirrors the OwnerSummary headline */}
          <p className="text-[40px] font-mono font-bold text-text leading-none tabular-nums">
            {formatINR(totalRevenue)}
          </p>

          <div className="grid grid-cols-2 gap-2 mt-5">
            <div className="bg-bg border border-border rounded-2xl p-3 flex flex-col gap-0.5">
              <p className="text-[20px] font-mono font-bold text-text tabular-nums">{sessionCount}</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Sessions</p>
            </div>
            <div className="bg-bg border border-border rounded-2xl p-3 flex flex-col gap-0.5">
              <p className="text-[20px] font-mono font-bold text-text tabular-nums">{saleCount}</p>
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Canteen sales</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OwnerSummary() {
  const tables = useTables()
  const settings = useSettings()
  const activeSessions = useActiveSessions()
  const currency = settings?.currency ?? '₹'

  // viewedDate stored as plain state — ephemeral, resets on remount
  const [viewedDate, setViewedDate] = useState<Date>(() => new Date())
  const [heatmapOpen, setHeatmapOpen] = useState(false)
  const viewedDateMs = startOfDay(viewedDate).getTime()

  useTick() // drives live running-session amounts every second

  const isViewedToday = isToday(viewedDate)

  // ── Build date keys for all comparison windows ──────────────────────────────

  // We need: current, yesterday-of-viewedDate, last-week-same-weekday, 7 days prior
  // Deduplicated map: dateKey → { start, end }
  const dateWindows = useMemo(() => {
    const windows = new Map<string, { start: number; end: number }>()
    const add = (d: Date) => {
      const key = toDateKey(d)
      if (!windows.has(key)) {
        windows.set(key, {
          start: startOfDay(d).getTime(),
          end: endOfDay(d).getTime(),
        })
      }
    }
    add(viewedDate)
    add(subDays(viewedDate, 1))
    add(subDays(viewedDate, 7))
    for (let i = 1; i <= 7; i++) add(subDays(viewedDate, i))
    return windows
  }, [viewedDateMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Single combined live query for all date revenue ──────────────────────────
  // Pattern T4: only DB-static values (completed amounts + items) here.
  // Running sessions computed in render body below.

  const dateRevenues = useLiveQuery(
    async () => {
      const result = new Map<string, { sessionsRevenue: number; itemsRevenue: number; walkInRevenue: number; sessions: Session[] }>()

      for (const [key, { start, end }] of dateWindows.entries()) {
        const sessions = await db.sessions
          .where('startedAt')
          .between(start, end, true, true)
          .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded
          .toArray()

        const sessionIds = sessions.map((s) => s.id!).filter(Boolean)
        const allItems = sessionIds.length
          ? await db.sessionItems
              .where('sessionId')
              .anyOf(sessionIds)
              .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
              .toArray()
          : []

        const itemsBySessionId = new Map<number, SessionItem[]>()
        for (const item of allItems) {
          const list = itemsBySessionId.get(item.sessionId) ?? []
          list.push(item)
          itemsBySessionId.set(item.sessionId, list)
        }

        // Only completed session amounts (DB-static, Pattern T4)
        const completedSessionsRevenue = sessions
          .filter((s) => s.status === 'completed')
          .reduce((sum, s) => sum + s.amount, 0)

        const itemsRevenue = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0)

        // #93 / Pattern T6: walk-in canteen revenue per date is part of the
        // day's total. Without this, yesterday/last-week/7d-avg deltas
        // understate days that had walk-in sales.
        const canteenSales = await db.canteenSales
          .where('createdAt')
          .between(start, end, true, true)
          .filter((c) => !c.deletedAt) // #166 — reversed walk-in sales leave per-date deltas
          .toArray()
        const walkInRevenue = canteenSales.reduce((sum, s) => sum + s.total, 0)

        result.set(key, { sessionsRevenue: completedSessionsRevenue, itemsRevenue, walkInRevenue, sessions })
      }

      return result
    },
    [viewedDateMs], // stable numeric dep (Pattern D6 lesson)
  )

  // ── Low stock count (live) ──────────────────────────────────────────────────
  const lowStockCount = useLiveQuery(async () => {
    const threshold = await getLowStockThreshold()
    const items = await getCanteenItems(false) // active only
    return items.filter(
      (i) => i.stockEnabled && (i.currentStock ?? 0) <= threshold
    ).length
  }, [])

  // ── Table lookup map ────────────────────────────────────────────────────────
  const tableMap = useMemo(() => {
    const m = new Map<number, GameTable>()
    for (const t of tables) if (t.id !== undefined) m.set(t.id, t)
    return m
  }, [tables])

  // ── Current date data from live query ──────────────────────────────────────
  const currentKey = toDateKey(viewedDate)
  const currentData = dateRevenues?.get(currentKey)

  // ── Secondary live query for current-date items (needed for heatmap/tables/canteen) ──
  const currentDateItems = useLiveQuery(
    async () => {
      const start = startOfDay(viewedDate).getTime()
      const end = endOfDay(viewedDate).getTime()
      const sessions = await db.sessions
        .where('startedAt')
        .between(start, end, true, true)
        .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded
        .toArray()
      const sessionIds = sessions.map((s) => s.id!).filter(Boolean)
      if (!sessionIds.length) return { sessions, itemsBySessionId: new Map<number, SessionItem[]>() }
      const allItems = await db.sessionItems
        .where('sessionId')
        .anyOf(sessionIds)
        .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
        .toArray()
      const itemsBySessionId = new Map<number, SessionItem[]>()
      for (const item of allItems) {
        const list = itemsBySessionId.get(item.sessionId) ?? []
        list.push(item)
        itemsBySessionId.set(item.sessionId, list)
      }
      return { sessions, itemsBySessionId }
    },
    [viewedDateMs],
  )

  const detailSessions = currentDateItems?.sessions ?? []
  const detailItemsMap = currentDateItems?.itemsBySessionId ?? new Map<number, SessionItem[]>()

  // Walk-in canteen sales for the viewed date — rolls into canteen revenue.
  // Phase 4 will reuse this query for the PAYMENT MODE breakdown tile.
  const canteenSalesForDate = useLiveQuery(
    async () => {
      const start = startOfDay(viewedDate).getTime()
      const end = endOfDay(viewedDate).getTime()
      return db.canteenSales
        .where('createdAt')
        .between(start, end, true, true)
        .filter((c) => !c.deletedAt) // #166 — reversed walk-in sales leave revenue + PAYMENT MODE
        .toArray()
    },
    [viewedDateMs],
    [],
  )
  const walkInCanteenRevenue = canteenSalesForDate.reduce(
    (sum, sale) => sum + sale.total,
    0,
  )

  // ── PAYMENT MODE breakdown (Pattern T4 — excludes running sessions) ───────
  // Source data:
  //   (a) stopped sessions on the viewed date that have paymentBreakdown
  //   (b) walk-in canteen sales on the viewed date (always have breakdown)
  // Running sessions have no breakdown yet; they are EXCLUDED here and a
  // small caveat reports the count. The headline revenue total continues
  // to include their live amounts (computed elsewhere in render body).
  const paymentMode = useMemo(() => {
    let cash = 0
    let upi = 0
    let wallet = 0
    let runningCount = 0
    for (const s of detailSessions) {
      if (s.status !== 'completed') {
        runningCount += 1
        continue
      }
      const pb = s.paymentBreakdown
      if (!pb) continue // legacy/edge — skip rather than guess
      cash += pb.cash
      upi += pb.upi
      wallet += pb.wallet
    }
    for (const sale of canteenSalesForDate) {
      const pb = sale.paymentBreakdown
      cash += pb.cash
      upi += pb.upi
      wallet += pb.wallet
    }
    return { cash, upi, wallet, runningCount }
  }, [detailSessions, canteenSalesForDate])
  const paymentModeTotal = paymentMode.cash + paymentMode.upi + paymentMode.wallet

  // ── CASH FLOW — piggy + today's restocks ─────────────────────────────────
  // Piggy balance is live (re-fires on any session/canteenSale/walletTx/restock write).
  const piggy = useLiveQuery(() => getPiggyBalance(), [])
  // Restocks on the viewed date (any source for the "stock bought today" tile)
  const stockPurchasesForDate = useLiveQuery(
    async () => {
      const start = startOfDay(viewedDate).getTime()
      const end = endOfDay(viewedDate).getTime()
      return db.stockPurchases
        .where('createdAt')
        .between(start, end, true, true)
        .toArray()
    },
    [viewedDateMs],
    [],
  )
  const spentOnStockTodayTotal = stockPurchasesForDate.reduce(
    (sum, p) => sum + p.cost,
    0,
  )
  const spentOnStockTodayPiggy = stockPurchasesForDate
    .filter((p) => p.source === 'piggy')
    .reduce((sum, p) => sum + p.cost, 0)
  const stockPurchaseCount = stockPurchasesForDate.length

  // Cash added to piggy on the viewed date — sums all three cash-in sources
  // restricted to viewed date AND piggyStartedAt (settings.piggyStartedAt is
  // baked into the piggy.cashIn aggregate, so we re-derive only for the viewed
  // date here — past dates before piggyStartedAt naturally show 0).
  const cashInOnDate = useLiveQuery(
    async () => {
      const start = startOfDay(viewedDate).getTime()
      const end = endOfDay(viewedDate).getTime()
      const settings = await db.settings.get(1)
      const since = settings?.piggyStartedAt ?? 0
      const winStart = Math.max(start, since)
      if (winStart > end) return 0

      const [sessions, sales, walletCredits] = await Promise.all([
        db.sessions
          .where('endedAt')
          .between(winStart, end, true, true)
          .filter(
            (s) => s.status === 'completed' && s.paymentBreakdown !== undefined && !s.deletedAt, // #162
          )
          .toArray(),
        db.canteenSales
          .where('createdAt')
          .between(winStart, end, true, true)
          .filter((c) => !c.deletedAt) // #166 — reversed walk-in sales leave this cash aggregate
          .toArray(),
        db.walletTransactions
          .where('createdAt')
          .between(winStart, end, true, true)
          .filter((t) => t.type === 'credit' && t.paymentMode === 'cash')
          .toArray(),
      ])
      const a = sessions.reduce((sum, s) => sum + (s.paymentBreakdown?.cash ?? 0), 0)
      const b = sales.reduce((sum, c) => sum + c.paymentBreakdown.cash, 0)
      const c = walletCredits.reduce((sum, t) => sum + t.amount, 0)
      return a + b + c
    },
    [viewedDateMs],
    0,
  )

  // ── Pattern T4: render-body running-session addition ────────────────────────
  // NOT in useMemo — useMemo only recomputes when activeSessions reference changes
  // (DB writes). useTick() re-renders must drive this every second, so it must
  // be inline in the render body.
  const todayStart = startOfDay(viewedDate).getTime()
  const runningRevenueToday = isViewedToday
    ? activeSessions
        .filter((s) => s.startedAt >= todayStart)
        .reduce((sum, s) => sum + calculateAmount(s, getElapsedMs(s)), 0)
    : 0

  // Total revenue = DB-static completed + items + live running (today only)
  // + walk-in canteen sales (Phase 3 — atomic rows, no "running" equivalent)
  const totalRevenue =
    (currentData?.sessionsRevenue ?? 0) +
    (currentData?.itemsRevenue ?? 0) +
    runningRevenueToday +
    walkInCanteenRevenue

  // ── Revenue split (tables vs canteen) ──────────────────────────────────────
  // Compute from detail sessions + items
  let tablesRevenue = 0
  let canteenRevenue = 0
  for (const s of detailSessions) {
    const sessionAmt =
      s.status === 'completed'
        ? s.amount
        : isViewedToday
        ? calculateAmount(s, getElapsedMs(s))
        : s.amount
    tablesRevenue += sessionAmt
    const items = detailItemsMap.get(s.id!) ?? []
    canteenRevenue += calculateItemsTotal(items)
  }
  // Walk-in canteen sales roll into the same canteen tile
  canteenRevenue += walkInCanteenRevenue
  // Add today's running items from active sessions if not already counted
  // (active sessions that haven't stopped yet don't have items via detailItemsMap
  // unless the query caught them — it does since startedAt filter covers them)

  // ── Delta comparisons ──────────────────────────────────────────────────────
  const getDateTotal = (date: Date): number => {
    const key = toDateKey(date)
    const data = dateRevenues?.get(key)
    if (!data) return 0
    return data.sessionsRevenue + data.itemsRevenue + data.walkInRevenue
  }

  // For 7d avg: average the 7 days prior to viewedDate (not including viewedDate)
  const trailing7Avg = useMemo(() => {
    if (!dateRevenues) return 0
    let sum = 0
    let count = 0
    for (let i = 1; i <= 7; i++) {
      const key = toDateKey(subDays(viewedDate, i))
      const data = dateRevenues.get(key)
      if (data) {
        sum += data.sessionsRevenue + data.itemsRevenue + data.walkInRevenue
        count++
      }
    }
    return count > 0 ? Math.round(sum / count) : 0
  }, [dateRevenues, viewedDateMs])

  const vsYesterday = dateRevenues
    ? computeDelta(totalRevenue, getDateTotal(subDays(viewedDate, 1)))
    : undefined
  const vsLastWeek = dateRevenues
    ? computeDelta(totalRevenue, getDateTotal(subDays(viewedDate, 7)))
    : undefined
  const vs7dAvg = dateRevenues
    ? computeDelta(totalRevenue, trailing7Avg)
    : undefined

  // ── Aggregate stats ─────────────────────────────────────────────────────────
  const sessionCount = detailSessions.length
  const totalElapsedMs = detailSessions.reduce((sum, s) => sum + getElapsedMs(s), 0)
  const avgSessionRevenue =
    sessionCount > 0 ? Math.round(totalRevenue / sessionCount) : 0

  // ── Hourly heatmap ──────────────────────────────────────────────────────────
  // NOT wrapped in useMemo — running sessions call getElapsedMs() which must
  // recompute every useTick() render. useMemo would freeze the value between
  // DB writes (Pattern T4).
  // #93: empty-state guard now also considers walk-in sales — if today has
  // only Quick Sales (zero sessions), the heatmap should still show those hours.
  const { buckets: hourlyBuckets, peakHour } = !detailSessions.length && canteenSalesForDate.length === 0
    ? { buckets: Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, sessionCount: 0 })), peakHour: -1 }
    : bucketByHour(detailSessions, detailItemsMap, canteenSalesForDate)

  // ── Top tables ──────────────────────────────────────────────────────────────
  // NOT wrapped in useMemo — same Pattern T4 reason as hourlyBuckets above.
  // #93: pass canteenSalesForDate so a synthetic "Walk-in Canteen" row joins
  // the ranking when walk-in revenue > 0 (TopTablesList detects WALKIN_TABLE_ID).
  const topTables = rankTables(detailSessions, detailItemsMap, tables, canteenSalesForDate)

  // ── Top canteen items ───────────────────────────────────────────────────────
  const allItems = useMemo(() => {
    const result: SessionItem[] = []
    for (const items of detailItemsMap.values()) {
      result.push(...items)
    }
    return result
  }, [detailItemsMap])

  // #93: merge walk-in canteen lines into the same name-keyed ranking.
  const topCanteen = useMemo(
    () => topCanteenItems(allItems, canteenSalesForDate, 3),
    [allItems, canteenSalesForDate],
  )

  // ── Sorted session rows ─────────────────────────────────────────────────────
  const sortedSessions = useMemo(
    () => [...detailSessions].sort((a, b) => b.startedAt - a.startedAt),
    [detailSessions],
  )

  const hasNoData = sessionCount === 0 && canteenRevenue === 0

  // ── Export CSV ──────────────────────────────────────────────────────────────
  function handleExport() {
    const headers = [
      'Table', 'Player', 'Players', 'Start', 'End',
      'Duration (min)', `Table Amount (${currency})`, `Items (${currency})`, `Total (${currency})`,
      'Billing', 'Frames',
    ]
    const exportRows = [...detailSessions]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((s) => {
        const t = tableMap.get(s.tableId)
        const elapsed = getElapsedMs(s)
        const tableAmt = s.status === 'completed' ? s.amount : calculateAmount(s, elapsed)
        const items = detailItemsMap.get(s.id!) ?? []
        const itemsAmt = calculateItemsTotal(items)
        return [
          t?.name ?? `Table ${s.tableId}`,
          s.playerName ?? '',
          s.playerCount,
          format(s.startedAt, 'yyyy-MM-dd HH:mm:ss'),
          s.endedAt ? format(s.endedAt, 'yyyy-MM-dd HH:mm:ss') : 'Running',
          Math.floor(elapsed / 60_000),
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
    a.download = `clubkeeper-${format(viewedDate, 'yyyy-MM-dd')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Date picker change ──────────────────────────────────────────────────────
  function handleDateChange(value: string) {
    if (!value) return
    const [y, m, d] = value.split('-').map(Number)
    setViewedDate(new Date(y, (m as number) - 1, d as number))
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Header with calendar icon + export */}
      <div className="px-5 pt-4 pb-3">
        <SummaryHeader
          viewedDate={viewedDate}
          onChange={setViewedDate}
          todayISO={todayISO()}
          onExport={detailSessions.length > 0 ? handleExport : undefined}
        />
      </div>

      {/* Headline block */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-1">
          Day's earnings
        </p>
        <p className="text-[40px] font-mono font-bold text-text leading-none tabular-nums">
          {formatINR(totalRevenue)}
        </p>

        {/* Delta chips */}
        <RevenueDeltas
          vsYesterday={vsYesterday}
          vsLastWeek={vsLastWeek}
          vs7dAvg={vs7dAvg}
        />
      </div>

      {/* Revenue split — Tables vs Canteen */}
      <RevenueSplitBar tablesRevenue={tablesRevenue} canteenRevenue={canteenRevenue} />

      {/* Payment mode breakdown — hidden when zero totals */}
      {paymentModeTotal > 0 && (
        <PaymentModeStrip
          cash={paymentMode.cash}
          upi={paymentMode.upi}
          wallet={paymentMode.wallet}
          runningSessionsExcluded={paymentMode.runningCount}
        />
      )}

      {/* Cash flow — piggy + today's restocks */}
      <CashFlowStrip
        piggyCurrent={piggy?.current ?? 0}
        piggyOpening={piggy?.opening ?? 0}
        cashInToday={cashInOnDate}
        spentOnStockToday={spentOnStockTodayPiggy}
        spentOnStockTodayCount={stockPurchaseCount}
        spentOnStockTodayTotal={spentOnStockTodayTotal}
        warnNegative={(piggy?.current ?? 0) < 0}
      />

      {/* Key metrics strip */}
      <div className="grid grid-cols-3 gap-2 px-5 mt-5">
        <div className="bg-bg-card border border-border rounded-2xl p-3 flex flex-col gap-0.5">
          <p className="text-[20px] font-mono font-bold text-text tabular-nums">{sessionCount}</p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Sessions</p>
        </div>
        <div className="bg-bg-card border border-border rounded-2xl p-3 flex flex-col gap-0.5">
          <p className="text-[20px] font-mono font-bold text-text tabular-nums">
            {sessionCount > 0 ? formatDuration(totalElapsedMs) : '—'}
          </p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Time Played</p>
        </div>
        <div className="bg-bg-card border border-border rounded-2xl p-3 flex flex-col gap-0.5">
          <p className="text-[20px] font-mono font-bold text-text tabular-nums">
            {sessionCount > 0 ? formatINR(avgSessionRevenue) : '—'}
          </p>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Avg session</p>
        </div>
      </div>

      {/* Low stock strip */}
      <LowStockStrip count={lowStockCount ?? 0} />

      {hasNoData ? (
        /* Empty state */
        <div className="flex flex-col items-center py-16 text-center px-5 mt-4">
          <p className="text-text-faint text-[15px] font-semibold">No activity yet</p>
          <p className="text-text-faint/60 text-[13px] mt-1">
            {isViewedToday ? 'Sessions will appear here as you run them' : 'No sessions on this day'}
          </p>
        </div>
      ) : (
        <>
          {/* Hourly heatmap — collapsible, hidden when no data */}
          {peakHour >= 0 && (
            <div className="px-5 mt-6">
              <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
                {/* Collapsible header */}
                <button
                  type="button"
                  onClick={() => setHeatmapOpen((o) => !o)}
                  aria-expanded={heatmapOpen}
                  className="w-full flex items-center gap-3 px-4 py-4 min-h-[52px] text-left"
                >
                  <span className="flex-1 text-[10px] font-mono uppercase tracking-widest text-text-faint">
                    Revenue by Hour
                  </span>
                  {/* Peak chip — only when collapsed */}
                  {!heatmapOpen && (
                    <span className="text-[11px] font-mono text-text-dim bg-bg border border-border rounded-full px-2.5 py-1 shrink-0">
                      Peak {new Date(2000, 0, 1, peakHour).toLocaleString('en-IN', { hour: 'numeric', hour12: true })} · {formatINR(hourlyBuckets[peakHour]?.revenue ?? 0)}
                    </span>
                  )}
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    className={`text-text-faint shrink-0 transition-transform duration-200 ${heatmapOpen ? 'rotate-90' : ''}`}
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                {/* Collapsible body */}
                <div className={`grid transition-all duration-200 ease-out ${heatmapOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                  <div className="overflow-hidden">
                    <div className="border-t border-border pb-2">
                      <HourlyHeatmap buckets={hourlyBuckets} peakHour={peakHour} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top tables */}
          {topTables.length > 0 && (
            <TopTablesList tables={topTables} />
          )}

          {/* Top canteen items */}
          {topCanteen.length > 0 && (
            <TopCanteenItems items={topCanteen} />
          )}

          {/* Sessions list */}
          <div className="px-5 mt-6">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">
              {isViewedToday ? "Today's Sessions" : 'Sessions'}
            </p>
            <div className="bg-bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
              {sortedSessions.map((session) => {
                const items = detailItemsMap.get(session.id!) ?? []
                const base =
                  session.status === 'completed'
                    ? session.amount
                    : calculateAmount(session, getElapsedMs(session))
                const itemsAmt = calculateItemsTotal(items)
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
        </>
      )}
    </div>
  )
}
