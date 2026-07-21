import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { startOfDay, endOfDay } from 'date-fns'
import { useTables, useActiveSessions, useSettings, useSyncClubFromSupabase } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { useSessionAlarm } from '../hooks/useSessionAlarm'
import { getElapsedMs } from '../lib/time'
import { calculateAmount } from '../lib/money'
import { stopSession, acknowledgeNotify, snoozeNotify, reconcileActiveSessions, RUNAWAY_MINUTES_DEFAULT } from '../db/queries'
import { useDexieSetting } from '../hooks/useDexieSetting'
import { db } from '../db/database'
import TopBar from '../components/TopBar'
import SummaryStrip from '../components/SummaryStrip'
import FilterPills from '../components/FilterPills'
import TableCard from '../components/TableCard'
import { Modal } from '../components/Modal'
import { TableFormModal } from '../components/TableFormModal'
import { OwnerOnly } from '../components/auth/RoleGuard'
import { SubscriptionStatusBanner } from '../components/SubscriptionStatusBanner'
import { SessionAlarmModal } from '../components/SessionAlarmModal'
import type { GameType, Session } from '../types'

type FilterValue = 'all' | GameType

const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000

export default function Home() {
  useSyncClubFromSupabase()
  const tables = useTables()
  const activeSessions = useActiveSessions()
  const settings = useSettings()
  const navigate = useNavigate()
  const { showBanner: showInstall, install, dismiss: dismissInstall } = useInstallPrompt()

  useTick()

  const [activeFilter, setActiveFilter] = useState<FilterValue>('all')
  const [addTableOpen, setAddTableOpen] = useState(false)
  const [orphanedOpen, setOrphanedOpen] = useState(false)
  // Post-v20 ID law (Pattern R5): session ids are UUID strings; was `number` so
  // `endingId === s.id` was always false and the End button never showed its
  // in-flight state (#134 sibling).
  const [endingId, setEndingId] = useState<string | null>(null)
  const [showDisabled, setShowDisabled] = useState(false)

  // Alarm — checked every useTick() re-render (Pattern T1, Pattern T4)
  const alarmSession = useSessionAlarm(activeSessions)

  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>() // Pattern R5: table ids are UUID strings (#134 sibling)
    for (const s of activeSessions) map.set(s.tableId, s)
    return map
  }, [activeSessions])

  // #168 — self-heal cross-device duplicate active sessions. LWW sync can land
  // two active rows on one table (both devices read "free", both wrote); the
  // header count would then exceed the rendered cards (cards dedup per table via
  // sessionMap, the count doesn't). reconcileActiveSessions keeps the earliest
  // and tombstones the rest (returning their stock). It's a no-op unless a table
  // has >1 active row, so we only call it when we actually detect a collision —
  // sessionMap losing entries vs activeSessions length is exactly that signal.
  // A ref debounces re-entry while the async tombstone is in flight. A
  // persistently-failing reconcile does NOT hot-loop: it retries only when the
  // duplicate signal next transitions false→true (next active-session change),
  // which is the correct backstop cadence for a best-effort self-heal.
  const reconcilingRef = useRef(false)
  const hasDuplicateActive = sessionMap.size < activeSessions.length
  useEffect(() => {
    if (!hasDuplicateActive || reconcilingRef.current) return
    reconcilingRef.current = true
    reconcileActiveSessions()
      .catch((e) => console.warn('[#168] reconcileActiveSessions failed:', e))
      .finally(() => { reconcilingRef.current = false })
  }, [hasDuplicateActive])

  // BUG-S7: hide outOfService tables on Home by default. Filter pills + counts
  // operate on the visible set so totals stay consistent. Owner can reveal
  // hidden tables inline via the "Show N disabled" toggle.
  const visibleTables = useMemo(
    () => (showDisabled ? tables : tables.filter((t) => !t.outOfService)),
    [tables, showDisabled],
  )
  const disabledCount = tables.filter((t) => t.outOfService).length

  const gameTypes = useMemo(
    () => [...new Set(visibleTables.map((t) => t.gameType))],
    [visibleTables],
  )

  const pills = useMemo(
    () => [
      { label: 'All', value: 'all' as const, count: visibleTables.length },
      ...gameTypes.map((gt) => ({
        label: gt.charAt(0).toUpperCase() + gt.slice(1),
        value: gt,
        count: visibleTables.filter((t) => t.gameType === gt).length,
      })),
    ],
    [visibleTables, gameTypes],
  )

  const filteredTables = useMemo(
    () => visibleTables.filter((t) => activeFilter === 'all' || t.gameType === activeFilter),
    [visibleTables, activeFilter],
  )

  const totalTables = tables.filter((t) => !t.outOfService).length
  // #168 — count UNIQUE running TABLES, not running session rows. Cards render
  // per table (sessionMap dedups), so counting rows made the header exceed the
  // card count whenever a duplicate active row slipped in via LWW sync. This
  // keeps the header truthful even in the frame before reconcileActiveSessions
  // heals the underlying dup.
  const runningCount = new Set(
    activeSessions.filter((s) => s.status === 'running').map((s) => s.tableId),
  ).size

  // Today total — split into two parts so useTick() can drive the running portion:
  // 1. DB-static: completed session amounts + all today's items + walk-in Quick
  //    Sales (re-fires only on DB write)
  // 2. Live: running/paused session amounts computed in render body (recalculates every tick)
  const todayStaticTotals = useLiveQuery(async () => {
    const start = startOfDay(new Date()).getTime()
    const end = endOfDay(new Date()).getTime()
    const todaySessions = await db.sessions
      .where('startedAt')
      .between(start, end, true, true)
      .filter((s) => !s.deletedAt) // #162 — reversed sessions excluded from today's total
      .toArray()

    const sessionIds = todaySessions.map((s) => s.id!).filter(Boolean)
    const sessionItems = sessionIds.length
      ? await db.sessionItems
          .where('sessionId')
          .anyOf(sessionIds)
          .filter((i) => !i.deletedAt) // #124 — soft-deleted excluded
          .toArray()
      : []

    // #141 — Quick Sales are CanteenSale rows (no session, no sessionItems), so
    // they were silently missing from today's total. Sum them the same way
    // Summary.tsx does (createdAt window → reduce sale.total). Pattern T6/#93.
    const canteenSales = await db.canteenSales
      .where('createdAt')
      .between(start, end, true, true)
      .filter((c) => !c.deletedAt) // #166 — reversed walk-in sales leave today's total
      .toArray()

    const completedAmount = todaySessions
      .filter((s) => s.status === 'completed')
      .reduce((sum, s) => sum + s.amount, 0)
    const itemsAmount = sessionItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const quickSaleAmount = canteenSales.reduce((sum, s) => sum + s.total, 0)

    return { completed: completedAmount, items: itemsAmount, quickSales: quickSaleAmount }
  }, [], { completed: 0, items: 0, quickSales: 0 })

  // Running/paused sessions recalculate on every useTick() re-render
  const runningAmount = activeSessions.reduce(
    (sum, s) => sum + calculateAmount(s, getElapsedMs(s)),
    0,
  )

  const todayTotal =
    (todayStaticTotals?.completed ?? 0) +
    (todayStaticTotals?.items ?? 0) +
    (todayStaticTotals?.quickSales ?? 0) +
    runningAmount

  const currency = settings?.currency ?? '₹'

  // Sessions running/paused for > 24h
  const orphanedSessions = useMemo(() => {
    const cutoff = Date.now() - ORPHAN_THRESHOLD_MS
    return activeSessions.filter((s) => s.startedAt < cutoff)
  }, [activeSessions])

  // #161 — runaway sessions: running past the owner's threshold but NOT yet
  // orphaned (>24h has its own banner). Computed in the RENDER BODY (not
  // useMemo) so useTick() re-evaluates elapsed every second — Pattern T4:
  // getElapsedMs is Date.now()-derived and must run on every render, never be
  // cached in a memo/live-query. 0 = feature off.
  const [runawayMinutes] = useDexieSetting('runawaySessionMinutes', RUNAWAY_MINUTES_DEFAULT)
  const runawaySessions =
    runawayMinutes > 0
      ? activeSessions.filter(
          (s) =>
            s.status === 'running' && // paused sessions aren't inflating the bill; getElapsedMs freezes on pause anyway
            s.startedAt >= Date.now() - ORPHAN_THRESHOLD_MS && // not already orphaned (>24h has its own banner)
            getElapsedMs(s) > runawayMinutes * 60_000,
        )
      : []

  async function handleEndOrphaned(id: string) {
    setEndingId(id)
    try {
      await stopSession(id)
    } finally {
      setEndingId(null)
    }
  }

  async function handleAlarmStop() {
    if (!alarmSession?.id) return
    // Acknowledge first so alarm doesn't refire while navigating
    await acknowledgeNotify(alarmSession.id)
    navigate(`/session/${alarmSession.id}`)
  }

  async function handleAlarmSnooze(ms: number) {
    if (!alarmSession?.id) return
    await snoozeNotify(alarmSession.id, ms)
  }

  return (
    <div className="bg-bg min-h-screen">
      {/* Desktop container: caps content at ~1400px and centers it.
          Mobile (<768px) is unaffected — max-w-[1400px] is wider than the viewport. */}
      <div className="max-w-[1400px] mx-auto">

      {/* Install banner */}
      {showInstall && (
        <div className="pt-safe">
          <div className="mx-4 mt-3 flex items-center justify-between gap-3 bg-accent/10 border border-accent/30 rounded-xl px-4 py-3">
            <p className="text-[13px] text-text leading-snug">
              Install ClubKeeper for offline use
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={install}
                className="text-[12px] font-bold text-bg bg-accent px-3 py-1.5 rounded-lg"
              >
                Install
              </button>
              <button
                onClick={dismissInstall}
                className="text-[12px] text-text-faint px-2 py-1.5"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orphaned sessions banner */}
      {orphanedSessions.length > 0 && (
        <div className={showInstall ? 'mx-4 mt-2' : 'pt-safe mx-4 mt-3'}>
          <div className="flex items-center justify-between bg-paused/10 border border-paused/30 rounded-xl px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-paused leading-tight">
                {orphanedSessions.length} session{orphanedSessions.length !== 1 ? 's' : ''} still running
              </p>
              <p className="text-[11px] text-text-faint mt-0.5">Started over 24h ago</p>
            </div>
            <button
              onClick={() => setOrphanedOpen(true)}
              className="text-[12px] font-semibold text-accent"
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {/* #161 — runaway-session warning: a running session past the owner's
          threshold. Distinct from the >24h orphan banner (this fires hours
          earlier). Tapping a row opens that session so the owner can stop/fix
          it before the bill inflates further. */}
      {runawaySessions.length > 0 && (
        <div className={showInstall || orphanedSessions.length > 0 ? 'mx-4 mt-2' : 'pt-safe mx-4 mt-3'}>
          <div className="bg-busy/10 border border-busy/40 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[15px]" aria-hidden="true">⏱️</span>
              <p className="text-[13px] font-bold text-busy leading-tight">
                {runawaySessions.length} session{runawaySessions.length !== 1 ? 's' : ''} running a long time — still playing?
              </p>
            </div>
            <div className="space-y-1">
              {runawaySessions.map((s) => {
                const mins = Math.floor(getElapsedMs(s) / 60_000)
                const h = Math.floor(mins / 60)
                const m = mins % 60
                const tableName = tables?.find((t) => t.id === s.tableId)?.name ?? 'Table'
                return (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/session/${s.id}`)}
                    className="w-full min-h-[44px] flex items-center justify-between text-left active:bg-busy/10 rounded-lg px-1 transition-colors"
                  >
                    <span className="text-[13px] text-text font-medium truncate min-w-0 flex-1">{tableName}</span>
                    <span className="text-[13px] font-mono text-busy shrink-0 ml-2">
                      {h > 0 ? `${h}h ` : ''}{m}m →
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className={showInstall || orphanedSessions.length > 0 || runawaySessions.length > 0 ? 'px-4 mt-0' : 'pt-safe px-4'}>
        <TopBar onQuickSalePress={() => navigate('/quick-sale')} />
        <SummaryStrip totalTables={totalTables} runningCount={runningCount} todayTotal={todayTotal} currency={currency} />
        <FilterPills pills={pills} active={activeFilter} onChange={setActiveFilter} />
      </div>

      <SubscriptionStatusBanner />

      <div className="px-4 pb-6 space-y-3 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">
        {filteredTables.map((table) => (
          <TableCard
            key={table.id}
            table={table}
            session={sessionMap.get(table.id!)}
            onStartTap={() => navigate(`/start/${table.id}`)}
          />
        ))}
      </div>

      {disabledCount > 0 && (
        <div className="px-4 pb-6 md:col-span-2 lg:col-span-3">
          <button
            onClick={() => setShowDisabled((v) => !v)}
            className="w-full min-h-[44px] py-2.5 text-[12px] font-mono uppercase tracking-widest text-text-faint border border-dashed border-border rounded-xl active:bg-bg-card transition-colors"
          >
            {showDisabled
              ? `Hide ${disabledCount} disabled`
              : `Show ${disabledCount} disabled`}
          </button>
        </div>
      )}

      </div>
      {/* /max-w-5xl — FAB and modals are viewport-fixed, must live outside */}

      {/* FAB — opens Add Table modal inline. Owner-only (Pattern A12): a table
          create is a game_tables INSERT, which staff RLS forbids — a staff tap
          would dead-letter the outbox. Gate removes trigger AND modal mount. */}
      <OwnerOnly>
        <button
          onClick={() => setAddTableOpen(true)}
          className="fixed bottom-20 right-5 w-14 h-14 bg-accent text-bg rounded-2xl flex items-center justify-center text-2xl font-bold z-50 active:scale-95 transition-transform"
          style={{ boxShadow: '0 0 24px rgba(184,255,90,0.35), 0 4px 12px rgba(0,0,0,0.4)' }}
          aria-label="Add table"
        >
          +
        </button>

        {/* Add Table modal — opened by FAB */}
        <TableFormModal
          open={addTableOpen}
          onClose={() => setAddTableOpen(false)}
          existingTables={tables}
        />
      </OwnerOnly>

      {/* Session alarm modal — fullscreen, covers bottom nav (z-50) */}
      {alarmSession && (
        <SessionAlarmModal
          session={alarmSession}
          tableName={tables.find((t) => t.id === alarmSession.tableId)?.name ?? `Table ${alarmSession.tableId}`}
          onStopSession={() => void handleAlarmStop()}
          onSnooze={(ms) => void handleAlarmSnooze(ms)}
          soundEnabled={settings?.alarmSoundEnabled ?? true}
          vibrationEnabled={settings?.alarmVibrationEnabled ?? true}
        />
      )}

      {/* Orphaned sessions modal */}
      <Modal
        open={orphanedOpen}
        onClose={() => setOrphanedOpen(false)}
        title="Long-running sessions"
      >
        <p className="text-text-faint text-[13px] mb-4">
          These sessions have been running for over 24 hours. You can end them now or review individually.
        </p>
        <div className="space-y-3 mb-4">
          {orphanedSessions.map((s) => {
            const t = tables.find((tbl) => tbl.id === s.tableId)
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 bg-bg border border-border rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text truncate">{t?.name ?? `Table ${s.tableId}`}</p>
                  <p className="text-[11px] font-mono text-text-faint mt-0.5">
                    Since {new Date(s.startedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => { setOrphanedOpen(false); navigate(`/session/${s.id}`) }}
                    className="text-[12px] text-accent font-semibold px-2 py-1"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleEndOrphaned(s.id!)}
                    disabled={endingId === s.id}
                    className="text-[12px] text-busy font-semibold px-2 py-1 disabled:opacity-50"
                  >
                    {endingId === s.id ? '…' : 'End'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
