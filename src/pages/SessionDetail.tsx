import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { db } from '../db/database'
import {
  pauseSession,
  resumeSession,
  stopSession,
  editSessionStart,
  updateSession,
  updateSessionNotify,
  moveSessionToTable,
  recordSessionPaymentBreakdown,
  pauseForPayment,
  confirmPaymentAndStop,
  cancelPaymentAndResume,
  creditBookingAdvanceRemainder,
  IncompatibleTableError,
  TableOccupiedError,
} from '../db/queries'
import type { Booking } from '../types/booking'
import { useTable, useTables, useSessionItems, useSettings } from '../hooks/useLiveData'
import { useTick } from '../hooks/useTick'
import { getElapsedMs, formatHMS, formatDuration } from '../lib/time'
import { calculateAmount, calculateItemsTotal, applyRounding } from '../lib/money'
import { NOTIFY_PRESETS } from '../lib/notifyPresets'
import { Modal } from '../components/Modal'
import { AddItemBottomSheet } from '../components/AddItemBottomSheet'
import { UpiQrCard } from '../components/UpiQrCard'
import { PaymentSplitSheet } from '../components/PaymentSplitSheet'
import { CoinRedemptionPill } from '../components/CoinRedemptionPill'
import { redeemCoins, getCoinConfig } from '../db/queries'
import { resolveCoinConfig } from '../lib/coins'
import { checkAndAwardStreak } from '../lib/streak'
import { useToastStore } from '../store/toastStore'
import type { CoinConfig } from '../lib/coins'
import type { Customer } from '../types/customer'
import type { Session, GameTable } from '../types'

// ─── Icons ────────────────────────────────────────────────────────────────────

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

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M12.5 2.5l3 3L5 16H2v-3L12.5 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function MoveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

// ─── Move Table Modal ─────────────────────────────────────────────────────────

type MovePhase = 'list' | 'confirm'

// Sub-component owns the occupancy live query so it can re-subscribe independently.
function MoveTableList({
  session,
  allTables,
  srcTable,
  rateLabel,
  onSelect,
}: {
  session: Session
  allTables: GameTable[]
  srcTable: GameTable | undefined
  rateLabel: string
  onSelect: (t: GameTable) => void
}) {
  const activeSessions = useLiveQuery(
    () => db.sessions.where('status').anyOf(['running', 'paused']).toArray(),
    [],
  ) as Session[] | undefined

  const occupiedTableIds = new Set((activeSessions ?? []).map((s) => s.tableId))

  const candidates = allTables.filter((t) => {
    if (!t.id || t.id === session.tableId) return false
    if (t.outOfService) return false
    if (t.gameType !== srcTable?.gameType) return false
    if (session.billingMode === 'per_hour') {
      if (t.ratePerHour !== srcTable?.ratePerHour) return false
    } else {
      if ((t.ratePerFrame ?? 0) !== (srcTable?.ratePerFrame ?? 0)) return false
    }
    // Mirror rate-card compatibility from moveSessionToTable (Pattern T7 + T8)
    const srcHasCard = (srcTable?.rateCard?.length ?? 0) > 0
    const destHasCard = (t.rateCard?.length ?? 0) > 0
    if (srcHasCard || destHasCard) {
      const srcTiers = srcTable?.rateCard ?? []
      const destTiers = t.rateCard ?? []
      const tiersMatch =
        srcTiers.length === destTiers.length &&
        srcTiers.every((tier, i) => tier.minutes === destTiers[i].minutes && tier.price === destTiers[i].price)
      const billingMatch =
        (srcTable?.rateCardBilling ?? 'prorated') === (t.rateCardBilling ?? 'prorated')
      const toleranceMatch =
        (srcTable?.toleranceMinutes ?? 10) === (t.toleranceMinutes ?? 10)
      if (!tiersMatch || !billingMatch || !toleranceMatch) return false
    }
    if (occupiedTableIds.has(t.id)) return false
    return true
  })

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <p className="text-text-dim text-sm text-center">No compatible tables are free right now.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto">
      {candidates.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          className="w-full min-h-[56px] flex items-center justify-between gap-3 px-4 py-3 bg-bg-card border border-border rounded-2xl active:border-accent transition-colors text-left"
        >
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-text truncate">{t.name}</p>
            <p className="text-[12px] text-text-faint mt-0.5">
              {session.rateCardSnapshot?.length ? 'Same rate card' : `Same rate (${rateLabel})`}
            </p>
          </div>
          <span className="text-text-faint shrink-0">
            <MoveIcon />
          </span>
        </button>
      ))}
    </div>
  )
}

function MoveTableModal({
  open,
  onClose,
  session,
  allTables,
  onMoved,
}: {
  open: boolean
  onClose: () => void
  session: Session
  allTables: GameTable[]
  onMoved: () => void
}) {
  const [phase, setPhase] = useState<MovePhase>('list')
  const [targetTable, setTargetTable] = useState<GameTable | null>(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPhase('list')
      setTargetTable(null)
      setMoving(false)
      setError(null)
    }
  }, [open])

  // Escape key
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const srcTable = allTables.find((t) => t.id === session.tableId)
  const rateLabel =
    session.billingMode === 'per_hour'
      ? `₹${session.rateSnapshot}/hr`
      : `₹${session.rateSnapshot}/frame`

  async function handleMove() {
    if (!targetTable?.id || moving) return
    setMoving(true)
    setError(null)
    try {
      await moveSessionToTable(session.id!, targetTable.id)
      onMoved()
      onClose()
    } catch (err) {
      if (err instanceof TableOccupiedError || err instanceof IncompatibleTableError) {
        setError(err.message)
        setPhase('list')
      } else {
        setError(err instanceof Error ? err.message : 'Move failed. Try again.')
      }
    } finally {
      setMoving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated rounded-t-3xl border-t border-border px-5 pt-5 pb-10">
        <div className="w-10 h-1 bg-border-bright rounded-full mx-auto mb-5" />
        <h4 className="text-[18px] font-bold tracking-tight text-text mb-3">Move to another table</h4>

        {error && (
          <p className="text-busy text-[13px] mb-3">{error}</p>
        )}

        {phase === 'list' ? (
          <MoveTableList
            session={session}
            allTables={allTables}
            srcTable={srcTable}
            rateLabel={rateLabel}
            onSelect={(t) => { setTargetTable(t); setPhase('confirm') }}
          />
        ) : (
          <div className="space-y-4">
            <p className="text-text-dim text-sm">
              Move from{' '}
              <span className="text-text font-semibold">
                {srcTable?.name ?? `Table ${session.tableId}`}
              </span>
              {' '}to{' '}
              <span className="text-text font-semibold">{targetTable?.name}</span>?
            </p>
            <p className="text-text-faint text-[12px]">
              Elapsed time and items carry over. Billing continues at the same rate.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => { setPhase('list'); setError(null) }}
                disabled={moving}
                className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleMove()}
                disabled={moving}
                className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-50"
              >
                {moving ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Detail row ───────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  accent = false,
  large = false,
  children,
}: {
  label: string
  value?: string
  accent?: boolean
  large?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0 py-3.5 border-b border-border last:border-0">
      <span className="text-[11px] uppercase tracking-widest font-mono text-text-faint shrink-0">
        {label}
      </span>
      {children ?? (
        <span
          className={`truncate min-w-0 flex-1 text-right font-semibold tabular-nums ${
            large ? 'text-[19px] font-bold' : 'text-[14px]'
          } ${accent ? 'text-accent' : 'text-text'}`}
        >
          {value}
        </span>
      )}
    </div>
  )
}

// ─── Alarm pill ───────────────────────────────────────────────────────────────

function AlarmPill({
  notifyAtMs,
  notifyAcknowledgedAt,
  onOpen,
}: {
  notifyAtMs: number | null
  notifyAcknowledgedAt: number | null
  onOpen: () => void
}) {
  const armed = notifyAtMs != null && !notifyAcknowledgedAt
  return (
    <button
      onClick={onOpen}
      className="mt-4 inline-flex items-center gap-1.5 px-4 min-h-[36px] rounded-full border border-border bg-bg-elevated text-[13px] font-semibold text-text-dim active:bg-bg-card transition-colors"
    >
      <span>⏰</span>
      {armed ? (
        <>
          <span className="text-text">Alarm at {format(notifyAtMs!, 'h:mm a')}</span>
          <span className="text-accent">· Edit</span>
        </>
      ) : (
        <span>Set alarm</span>
      )}
    </button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPlayers(s: Session): string {
  if (!s.playerName) {
    return `${s.playerCount} player${s.playerCount !== 1 ? 's' : ''}`
  }
  if (s.playerCount <= 1) return s.playerName
  return `${s.playerName} +${s.playerCount - 1}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SessionDetail() {
  const { sessionId: rawSessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  // Dual-accept route param (Phase B step 1.5 — #107). Legacy v19 = number,
  // v20-seeded = UUID string. Round-trip check prevents "123abc" → 123 truncation.
  const sid: number | string = (() => {
    if (rawSessionId === undefined || rawSessionId === '') return NaN
    const n = Number(rawSessionId)
    return Number.isFinite(n) && n > 0 && String(n) === rawSessionId ? n : rawSessionId
  })()
  const sidValid =
    typeof sid === 'string' ? sid.length > 0 : Number.isFinite(sid) && sid > 0

  // undefined = loading, null = not found, Session = loaded
  const session = useLiveQuery<Session | null>(
    async () => {
      if (!sidValid) return null
      return (await db.sessions.get(sid)) ?? null
    },
    [sid, sidValid],
  )

  const table = useTable(session != null ? session.tableId : undefined)
  const allTables = useTables()
  const items = useSessionItems(session != null ? session.id : undefined)
  const settings = useSettings()
  const { show: showToast } = useToastStore()

  // v17 P1e: if this session was started via a booking link, surface the booking
  // so PaymentSplitSheet can show the prepaid advance and short-circuit collection.
  // Pattern T4 — DB-static deps only; no clock math inside the live query.
  const linkedBooking = useLiveQuery<Booking | null>(
    async () => {
      if (!sidValid) return null
      const row = await db.bookings
        .where('status').equals('consumed')
        .filter((b) => b.consumedSessionId === sid)
        .first()
      return row ?? null
    },
    [sid, sidValid],
  )
  const prepaidAdvance = linkedBooking?.advanceAmount ?? 0

  // Tick every second so the timer re-renders
  useTick()

  const [confirmStop, setConfirmStop] = useState(false)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [editStartOpen, setEditStartOpen] = useState(false)
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [alarmSheetOpen, setAlarmSheetOpen] = useState(false)
  const [customAlarmMinutes, setCustomAlarmMinutes] = useState('')
  const [customAlarmError, setCustomAlarmError] = useState<string | null>(null)
  const [showCustomAlarm, setShowCustomAlarm] = useState(false)

  // Payment state — values frozen at pauseForPayment() so they don't change when
  // the DB record flips; reused by PaymentSplitSheet total + headline props.
  const [finalRoundedMs, setFinalRoundedMs] = useState(0)
  const [finalGrandTotal, setFinalGrandTotal] = useState(0)
  // v13: split-payment capture sheet
  const [splitSheetOpen, setSplitSheetOpen] = useState(false)
  const [breakdownRecorded, setBreakdownRecorded] = useState(false)
  // v15: coin redemption on payment screen
  const [coinConfig, setCoinConfig] = useState<CoinConfig>(resolveCoinConfig({}))
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(null)
  const [coinsApplied, setCoinsApplied] = useState(0)
  const [coinDiscount, setCoinDiscount] = useState(0)
  // ADDENDUM-4: if we land on a session that's already stopped but has no
  // paymentBreakdown (the user closed the tab during Phase 2 capture), we
  // re-enter the payment flow on mount. Tracked here so the auto-open effect
  // fires exactly once per mount.
  const [autoOpenHandled, setAutoOpenHandled] = useState(false)
  // Post-confirm screen: stores the confirmed breakdown so we can show UPI QR
  // (if upi > 0) or a "Payment recorded ✓" card (if upi === 0).
  const [confirmedBreakdown, setConfirmedBreakdown] = useState<{ cash: number; upi: number; wallet: number } | null>(null)

  // Load coin config once on mount
  useEffect(() => {
    getCoinConfig().then(setCoinConfig).catch(() => {/* use defaults */})
  }, [])

  // P1e: when a linked booking is present, auto-link its customer by phone so
  // PaymentSplitSheet shows wallet + the advance is wired to the right person.
  // linkBookingToSession in StartSession ensured the customer row exists.
  useEffect(() => {
    if (!linkedBooking || linkedCustomer) return
    let cancelled = false
    db.customers.where('phone').equals(linkedBooking.playerPhone).first().then((c) => {
      if (!cancelled && c) setLinkedCustomer(c)
    }).catch(() => { /* non-critical */ })
    return () => { cancelled = true }
  }, [linkedBooking, linkedCustomer])

  // Populate edit-start fields whenever the modal is opened
  useEffect(() => {
    if (!editStartOpen || !session) return
    const dt = new Date(session.startedAt)
    setEditDate(format(dt, 'yyyy-MM-dd'))
    setEditTime(format(dt, 'HH:mm'))
    setEditError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStartOpen])

  // Re-enter payment screen when navigating to a session that is paused-for-payment
  // (staff closed the tab or navigated away after pauseForPayment but before confirming).
  // Also handles legacy: completed session with no paymentBreakdown (Pattern P4).
  // Runs once per mount after session + items load.
  useEffect(() => {
    if (autoOpenHandled) return
    if (!session) return
    if (items === undefined) return

    // Case 1 (new): session is paused with paymentInProgress — re-enter payment flow
    if (session.status === 'paused' && session.paymentInProgress) {
      setAutoOpenHandled(true)
      // Re-derive the frozen total from session fields so PaymentSplitSheet gets the
      // right total prop. confirmPaymentAndStop recomputes authoritative amount in its tx.
      const pausedTotalMs = session.pausedTotalMs
      const rawMs = (session.pausedAt ?? Date.now()) - session.startedAt - pausedTotalMs
      const isRateCardSession = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
      const billableMs =
        !isRateCardSession && session.billingMode === 'per_hour'
          ? applyRounding(rawMs, rounding)
          : rawMs
      const tableAmt = calculateAmount(session, billableMs)
      const itemsTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
      const grandTotal = tableAmt + itemsTotal
      setFinalRoundedMs(billableMs)
      setFinalGrandTotal(grandTotal)
      if (grandTotal === 0) {
        void confirmPaymentAndStop(session.id!, { cash: 0, upi: 0, wallet: 0 })
          .then(() => {
            setBreakdownRecorded(true)
            setConfirmedBreakdown({ cash: 0, upi: 0, wallet: 0 })
          })
          .catch(() => {})
      } else {
        setSplitSheetOpen(true)
      }
      return
    }

    // Case 2 (legacy Pattern P4): completed session with no paymentBreakdown
    if (session.status !== 'completed') return
    if (session.paymentBreakdown !== undefined) return
    const itemsTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const grandTotal = session.amount + itemsTotal
    setAutoOpenHandled(true)
    setFinalGrandTotal(grandTotal)
    setFinalRoundedMs(
      session.roundedDurationMs ??
        ((session.endedAt ?? Date.now()) - session.startedAt - session.pausedTotalMs),
    )
    if (grandTotal === 0) {
      void recordSessionPaymentBreakdown(session.id!, { cash: 0, upi: 0, wallet: 0 })
        .then(() => setBreakdownRecorded(true))
        .catch(() => {})
    } else {
      setSplitSheetOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, items, autoOpenHandled])

  // ─── Loading / not-found guards ───────────────────────────────────────────

  if (session === undefined) {
    return (
      <div className="pt-safe min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-faint text-sm font-mono">Loading…</p>
      </div>
    )
  }

  if (session === null) {
    return (
      <div className="pt-safe min-h-screen bg-bg flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-text-dim text-[15px]">Session not found.</p>
        <button
          onClick={() => navigate('/tables')}
          className="text-accent text-sm font-semibold"
        >
          ← Back to Home
        </button>
      </div>
    )
  }

  // ─── Derived values (session: Session is now guaranteed) ──────────────────

  const elapsedMs = getElapsedMs(session)
  const rounding = settings?.rounding ?? 'none'

  // For the confirm preview: compute what WOULD be billed on stop
  const rawElapsedMs = elapsedMs
  const isRateCard = session.rateCardSnapshot && session.rateCardSnapshot.length > 0
  // Rate card sessions ignore rounding — pass raw elapsed; linear sessions round up
  const roundedElapsedMs =
    !isRateCard && session.billingMode === 'per_hour' ? applyRounding(rawElapsedMs, rounding) : rawElapsedMs
  const previewTableAmount = calculateAmount(session, roundedElapsedMs)
  const previewItemsTotal = calculateItemsTotal(items)
  const previewGrandTotal = previewTableAmount + previewItemsTotal

  // Current live display (for the bill split card — uses raw elapsed for running sessions)
  const currentSessionAmount =
    session.status === 'completed'
      ? session.amount
      : calculateAmount(session, elapsedMs)
  const itemsTotal = calculateItemsTotal(items)
  const grandTotal = currentSessionAmount + itemsTotal
  const totalItemQty = items.reduce((s, i) => s + i.quantity, 0)

  const hms = formatHMS(elapsedMs)
  const hhMm = hms.slice(0, 5)
  const ss = hms.slice(6)
  const tableName = table?.name ?? `Table ${session.tableId}`

  // Hero gradient
  const heroBg =
    session.status === 'running'
      ? 'linear-gradient(to bottom, rgba(255,107,74,0.07) 0%, transparent 85%)'
      : session.status === 'paused'
      ? 'linear-gradient(to bottom, rgba(255,184,74,0.07) 0%, transparent 85%)'
      : undefined

  // ─── Handlers ─────────────────────────────────────────────────────────────

  async function handlePause() {
    if (pending) return
    setPending(true)
    try {
      await pauseSession(session.id!)
    } finally {
      setPending(false)
    }
  }

  async function handleResume() {
    if (pending) return
    setPending(true)
    try {
      await resumeSession(session.id!)
    } finally {
      setPending(false)
    }
  }

  async function handleConfirmStop() {
    if (pending) return
    setPending(true)
    try {
      // Pause the session for payment (freeze the bill, don't stop yet).
      // confirmPaymentAndStop will atomically stop + record breakdown on confirm.
      const { billableMs, grandTotal } = await pauseForPayment(session.id!)
      setFinalRoundedMs(billableMs)
      setFinalGrandTotal(grandTotal)
      setConfirmStop(false)
      setCoinsApplied(0)
      setCoinDiscount(0)
      setLinkedCustomer(null)
      // Open split sheet directly — no pre-record QR screen (#77)
      if (grandTotal === 0) {
        await confirmPaymentAndStop(session.id!, { cash: 0, upi: 0, wallet: 0 })
        setBreakdownRecorded(true)
        setConfirmedBreakdown({ cash: 0, upi: 0, wallet: 0 })
      } else {
        setSplitSheetOpen(true)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleCancelPayment() {
    // Staff backed out of payment sheet — resume the session as running.
    try {
      await cancelPaymentAndResume(session.id!)
    } catch {
      // If cancel fails (e.g. session already completed), just close the screen.
    }
    setSplitSheetOpen(false)
    setBreakdownRecorded(false)
    setConfirmedBreakdown(null)
  }

  async function handleFrameChange(delta: number) {
    const current = session.framesPlayed ?? 0
    const next = Math.max(0, current + delta)
    await updateSession(session.id!, { framesPlayed: next })
  }

  async function handleSaveEditStart() {
    setEditError(null)
    const combined = new Date(`${editDate}T${editTime}:00`)
    if (isNaN(combined.getTime())) {
      setEditError('Invalid date or time.')
      return
    }
    const newTs = combined.getTime()
    if (newTs >= Date.now()) {
      setEditError('Start time must be in the past.')
      return
    }
    if (session.endedAt !== null && newTs >= session.endedAt) {
      setEditError('Start time must be before end time.')
      return
    }
    try {
      await editSessionStart(session.id!, newTs)
      setEditStartOpen(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update.')
    }
  }

  async function handleSetAlarm(notifyAfterMs: number | null) {
    await updateSessionNotify(session.id!, notifyAfterMs)
    setAlarmSheetOpen(false)
    setCustomAlarmMinutes('')
    setCustomAlarmError(null)
    setShowCustomAlarm(false)
  }

  async function handleCustomAlarmSave() {
    const mins = parseInt(customAlarmMinutes, 10)
    if (isNaN(mins) || mins < 1 || mins > 600) {
      setCustomAlarmError('Enter 1–600 minutes')
      return
    }
    await handleSetAlarm(mins * 60_000)
  }

  const isActive = session.status !== 'completed' && !session.paymentInProgress

  // ─── Post-confirm screen ──────────────────────────────────────────────────
  // Shown after payment is confirmed (confirmedBreakdown is set).
  // If upi > 0 → UPI QR for that portion only. If upi === 0 → "Payment recorded ✓" card.
  if (confirmedBreakdown !== null) {
    const upiId = settings?.upiId?.trim()
    const clubName = settings?.clubName || 'ClubKeeper'
    const upiAmount = confirmedBreakdown.upi
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col px-5" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <header className="flex flex-col items-center gap-1 shrink-0 pt-2">
          <div className="flex items-center gap-2 text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold uppercase tracking-widest">
              {upiAmount > 0 ? 'Collect UPI payment' : 'Payment recorded'}
            </span>
          </div>
          <div className="text-text-dim text-xs">{tableName}</div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center min-h-0 gap-4">
          {upiAmount > 0 ? (
            upiId ? (
              <>
                <UpiQrCard upiId={upiId} payeeName={clubName} amount={upiAmount} transactionNote={`${tableName} - UPI`} />
                <div className="flex flex-col items-center gap-1">
                  <div className="text-3xl font-mono font-bold text-text tabular-nums">₹{upiAmount.toLocaleString('en-IN')}</div>
                  <div className="text-xs text-text-dim">UPI portion — scan to pay</div>
                </div>
              </>
            ) : (
              <div className="bg-bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-2 w-full max-w-xs">
                <div className="text-3xl font-mono font-bold text-text tabular-nums">₹{upiAmount.toLocaleString('en-IN')}</div>
                <div className="text-text-dim text-sm">UPI portion to collect</div>
                <p className="text-text-faint text-xs text-center mt-1">Add your UPI ID in Settings to show a QR here.</p>
              </div>
            )
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-center w-full max-w-xs">
              <div className="text-3xl mb-2">✓</div>
              <div className="text-lg font-semibold mb-1 text-text">Payment recorded</div>
              <div className="text-sm text-text-dim">
                Cash ₹{confirmedBreakdown.cash.toLocaleString('en-IN')}
                {confirmedBreakdown.wallet > 0 && ` · Wallet ₹${confirmedBreakdown.wallet.toLocaleString('en-IN')}`}
              </div>
            </div>
          )}
        </main>
        <footer className="shrink-0 flex flex-col gap-3 pt-2">
          {upiAmount > 0 && upiId && <p className="text-xs text-text-faint text-center">Works with GPay, PhonePe, Paytm, BHIM</p>}
          <button onClick={() => navigate('/tables', { replace: true })} className="w-full min-h-[48px] rounded-xl bg-accent text-bg font-semibold text-base active:scale-[0.98] transition-transform">
            Done — back to tables
          </button>
        </footer>
      </div>
    )
  }


  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg pb-24">

      {/* Top bar */}
      <div className="pt-safe">
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <button
            onClick={() => navigate('/tables')}
            className="flex items-center gap-1 text-text-dim px-1 min-h-[44px] -ml-1 active:text-text transition-colors"
          >
            <ChevronLeft />
            <span className="text-sm">Home</span>
          </button>
          <button
            onClick={() => setEditStartOpen(true)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim active:text-text transition-colors"
            aria-label="Edit start time"
          >
            <PencilIcon />
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="px-4 pt-2 pb-7" style={{ background: heroBg }}>
        <div className="mb-3">
          {session.status === 'running' && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-busy">
              <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse" />
              Live Session
            </span>
          )}
          {session.status === 'paused' && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-paused">
              <span className="w-1.5 h-1.5 rounded-full bg-paused" />
              Paused
            </span>
          )}
          {session.status === 'completed' && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Completed
            </span>
          )}
        </div>
        <h1 className="text-[32px] font-extrabold tracking-tighter text-text leading-none mb-2">
          {tableName}
        </h1>
        <p className="text-[11px] font-mono uppercase tracking-wider text-text-faint">
          {table?.gameType ?? '—'}
          {' · '}₹{session.rateSnapshot}/{session.billingMode === 'per_hour' ? 'hr' : 'frame'}
          {' · '}Started {format(session.startedAt, 'h:mm a')}
        </p>
      </div>

      {/* Big timer */}
      <div className="flex flex-col items-center py-9">
        <div
          className="font-mono font-bold tracking-tighter leading-none"
          style={{ fontSize: '64px' }}
        >
          <span className={session.status === 'paused' ? 'text-paused' : 'text-text'}>
            {hhMm}
          </span>
          <span
            style={{ fontSize: '42px' }}
            className={session.status === 'paused' ? 'text-paused/60' : 'text-text-dim'}
          >
            :{ss}
          </span>
        </div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mt-3">
          Elapsed Time
        </p>

        {/* Alarm pill — only for active sessions */}
        {isActive && (
          <AlarmPill
            notifyAtMs={session.notifyAtMs ?? null}
            notifyAcknowledgedAt={session.notifyAcknowledgedAt ?? null}
            onOpen={() => {
              setCustomAlarmMinutes('')
              setCustomAlarmError(null)
              setShowCustomAlarm(false)
              setAlarmSheetOpen(true)
            }}
          />
        )}
      </div>

      {/* Detail rows */}
      <div className="px-4 border-t border-border">
        <DetailRow label="Players" value={formatPlayers(session)} />
        <DetailRow
          label="Started At"
          value={format(session.startedAt, 'h:mm a, d MMM')}
        />
        <DetailRow
          label="Rate"
          value={`₹${session.rateSnapshot}/${session.billingMode === 'per_hour' ? 'hr' : 'frame'}`}
        />

        {/* Frames stepper — per_frame billing only */}
        {session.billingMode === 'per_frame' && (
          <DetailRow label="Frames">
            <div className="flex items-center gap-4">
              <button
                onClick={() => handleFrameChange(-1)}
                disabled={(session.framesPlayed ?? 0) <= 0 || !isActive}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-xl font-bold text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors"
              >
                −
              </button>
              <span className="text-[20px] font-bold text-text w-8 text-center tabular-nums">
                {session.framesPlayed ?? 0}
              </span>
              <button
                onClick={() => handleFrameChange(1)}
                disabled={!isActive}
                className="w-8 h-8 rounded-lg bg-bg-elevated border border-border flex items-center justify-center text-xl font-bold text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors"
              >
                +
              </button>
            </div>
          </DetailRow>
        )}

        {session.note && (
          <DetailRow label="Note" value={session.note} />
        )}
      </div>

      {/* ── Table journey (shown when session has moved tables) ─────────── */}
      {(session.tableMoves?.length ?? 0) > 0 && (
        <div className="px-4 mt-4">
          <p className="text-[11px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
            Table Journey
          </p>
          <p className="text-[13px] text-text-dim truncate">
            {(() => {
              const moves = session.tableMoves!
              const tableIdToName = (id: number) =>
                allTables.find((t) => t.id === id)?.name ?? `Table ${id}`
              const first = tableIdToName(moves[0]!.fromTableId)
              const rest = moves.map((m) => tableIdToName(m.toTableId))
              return [first, ...rest].join(' → ')
            })()}
          </p>
        </div>
      )}

      {/* ── Bill split ──────────────────────────────────────────────────────── */}
      <div className="px-4 mt-5">
        <div className="bg-bg-card border border-border rounded-2xl p-4 space-y-2.5">
          <div className="flex justify-between items-baseline">
            <span className="text-text-dim text-sm">Table time</span>
            <span className="font-mono text-text">₹{currentSessionAmount.toLocaleString('en-IN')}</span>
          </div>
          {items.length > 0 && (
            <div className="flex justify-between items-baseline">
              <span className="text-text-dim text-sm">Items ({totalItemQty})</span>
              <span className="font-mono text-text">₹{itemsTotal.toLocaleString('en-IN')}</span>
            </div>
          )}
          <div className="h-px bg-border my-1" />
          <div className="flex justify-between items-baseline">
            <span className="text-text font-medium">Total</span>
            <span className="font-mono text-accent text-xl font-bold">₹{grandTotal.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="px-4 mt-4 space-y-3">
        {session.status === 'completed' ? (
          <button
            onClick={() => navigate('/tables')}
            className="w-full py-4 bg-bg-card text-text border border-border rounded-2xl text-[15px] font-bold active:scale-[0.99] transition-transform"
          >
            Back to Home
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {session.status === 'running' ? (
              <button
                onClick={handlePause}
                disabled={pending}
                className="py-4 bg-paused/10 text-paused border border-paused/30 rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
              >
                Pause
              </button>
            ) : (
              <button
                onClick={handleResume}
                disabled={pending}
                className="py-4 bg-accent text-bg rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
              >
                Resume
              </button>
            )}
            <button
              onClick={() => setConfirmStop(true)}
              disabled={pending}
              className="py-4 bg-busy text-white rounded-2xl text-[15px] font-bold disabled:opacity-50 active:scale-[0.99] transition-transform"
            >
              Stop Session
            </button>
          </div>
        )}

        {/* Add Item / View Items button */}
        {!isActive ? (
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full min-h-[44px] bg-bg-card text-text-dim border border-border rounded-2xl flex items-center justify-center gap-2 font-medium text-[14px] active:scale-[0.99] transition-transform"
          >
            View Items
          </button>
        ) : (
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full min-h-[44px] bg-bg-card text-text border border-border rounded-2xl flex items-center justify-center gap-2 font-medium text-[15px] active:scale-[0.99] transition-transform"
          >
            <PlusIcon />
            Add Item
          </button>
        )}

        {/* Move table button — active sessions only */}
        {isActive && (
          <button
            onClick={() => setMoveModalOpen(true)}
            className="w-full min-h-[44px] bg-bg-card text-text-dim border border-border rounded-2xl flex items-center justify-center gap-2 font-medium text-[14px] active:scale-[0.99] transition-transform"
          >
            <MoveIcon />
            Move table
          </button>
        )}

        {/* Edit start time */}
        <button
          onClick={() => setEditStartOpen(true)}
          className="w-full py-3.5 bg-bg-card text-text-dim border border-border rounded-2xl text-[14px] font-semibold active:scale-[0.99] transition-transform"
        >
          Edit Start Time
        </button>
      </div>

      {/* ── Stop confirmation modal ─────────────────────────────────────── */}
      <Modal
        open={confirmStop}
        onClose={() => !pending && setConfirmStop(false)}
        title="End this session?"
      >
        <div className="space-y-3 mb-5">
          <div className="text-text-dim text-sm">
            End session for <span className="text-text font-medium">{tableName}</span>?
          </div>
          <div className="bg-bg-card border border-border rounded-xl p-3 space-y-1.5 text-sm">
            {/* Time row — shows rounding if active */}
            <div className="flex justify-between">
              <span className="text-text-dim">Time</span>
              <span className="text-text font-mono">
                {formatDuration(roundedElapsedMs)}
                {roundedElapsedMs !== rawElapsedMs && (
                  <span className="text-text-faint text-xs ml-1">
                    (was {formatDuration(rawElapsedMs)})
                  </span>
                )}
              </span>
            </div>
            {/* Table time */}
            <div className="flex justify-between">
              <span className="text-text-dim">Table time</span>
              <span className="text-text font-mono">₹{previewTableAmount.toLocaleString('en-IN')}</span>
            </div>
            {/* Items row — only if present */}
            {items.length > 0 && (
              <div className="flex justify-between">
                <span className="text-text-dim">
                  Items ({items.reduce((s, i) => s + i.quantity, 0)})
                </span>
                <span className="text-text font-mono">₹{previewItemsTotal.toLocaleString('en-IN')}</span>
              </div>
            )}
            <div className="h-px bg-border my-1" />
            {/* Grand total */}
            <div className="flex justify-between items-baseline">
              <span className="text-text font-medium">Total</span>
              <span className="text-accent font-mono text-lg font-bold">
                ₹{previewGrandTotal.toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setConfirmStop(false)}
            disabled={pending}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmStop}
            disabled={pending}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {pending ? 'Ending…' : 'Yes, End Session'}
          </button>
        </div>
      </Modal>

      {/* ── Edit start time modal ───────────────────────────────────────── */}
      <Modal
        open={editStartOpen}
        onClose={() => setEditStartOpen(false)}
        title="Edit Start Time"
      >
        <p className="text-text-faint text-[12px] font-mono mb-4">
          Current: {format(session.startedAt, 'h:mm a, d MMM yyyy')}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
              Date
            </label>
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
              Time
            </label>
            <input
              type="time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors"
            />
          </div>
          {editError && (
            <p className="text-busy text-[13px]">{editError}</p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => setEditStartOpen(false)}
              className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEditStart}
              className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add Item bottom sheet ───────────────────────────────────────── */}
      <AddItemBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sessionId={session.id!}
        sessionStatus={session.status}
      />

      {/* ── Set Alarm bottom sheet ─────────────────────────────────────── */}
      <Modal
        open={alarmSheetOpen}
        onClose={() => {
          setAlarmSheetOpen(false)
          setCustomAlarmMinutes('')
          setCustomAlarmError(null)
          setShowCustomAlarm(false)
        }}
        title="Set Alarm"
      >
        <div className="mt-1 space-y-4">
          {/* Preset chips */}
          <div className="flex flex-wrap gap-2">
            {NOTIFY_PRESETS.map((preset) => {
              const armed = session.notifyAtMs != null && !session.notifyAcknowledgedAt
              const isActive_ =
                preset.ms === null
                  ? !armed && !showCustomAlarm
                  : false
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setShowCustomAlarm(false)
                    setCustomAlarmMinutes('')
                    setCustomAlarmError(null)
                    void handleSetAlarm(preset.ms)
                  }}
                  className={`min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold transition-colors ${
                    isActive_
                      ? 'bg-accent text-bg border-accent'
                      : 'bg-bg-elevated border-border text-text-dim active:bg-bg-card'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
            {/* Custom chip */}
            <button
              onClick={() => setShowCustomAlarm((v) => !v)}
              className={`min-h-[44px] px-4 rounded-xl border text-[13px] font-semibold transition-colors ${
                showCustomAlarm
                  ? 'bg-accent text-bg border-accent'
                  : 'bg-bg-elevated border-border text-text-dim active:bg-bg-card'
              }`}
            >
              Custom
            </button>
          </div>

          {/* Custom input */}
          {showCustomAlarm && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={customAlarmMinutes}
                  onChange={(e) => {
                    setCustomAlarmMinutes(e.target.value)
                    setCustomAlarmError(null)
                  }}
                  placeholder="Minutes from now (1–600)"
                  className="flex-1 bg-bg-elevated border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
                />
                <button
                  onClick={() => void handleCustomAlarmSave()}
                  className="min-h-[44px] px-5 bg-accent text-bg rounded-xl text-[14px] font-bold active:scale-[0.98] transition-transform"
                >
                  Set
                </button>
              </div>
              {customAlarmError && (
                <p className="text-busy text-[12px]">{customAlarmError}</p>
              )}
            </div>
          )}

          {/* Live hint — shows when custom minutes are entered or after a preset hover */}
          {(() => {
            const mins = parseInt(customAlarmMinutes, 10)
            if (!showCustomAlarm || isNaN(mins) || mins < 1 || mins > 600) return null
            const fireAt = new Date(Date.now() + mins * 60_000)
            return (
              <p className="text-[12px] text-accent">
                Alarm fires in {mins} min (at {format(fireAt, 'h:mm a')})
              </p>
            )
          })()}
        </div>
      </Modal>

      {/* ── Move Table modal ────────────────────────────────────────────── */}
      <MoveTableModal
        open={moveModalOpen}
        onClose={() => setMoveModalOpen(false)}
        session={session}
        allTables={allTables}
        onMoved={() => setMoveModalOpen(false)}
      />

      {/* ── Payment split sheet + coin pill ─────────────────────────────── */}
      {/* Rendered in main tree so it's accessible from both fresh stop and auto-resume paths. */}
      {splitSheetOpen && (() => {
        function durationLabel(ms: number): string {
          const totalMin = Math.floor(ms / 60000)
          if (totalMin < 1) return '<1 min'
          if (totalMin < 60) return `${totalMin} min`
          const h = Math.floor(totalMin / 60)
          const m = totalMin % 60
          return m > 0 ? `${h}h ${m}m` : `${h}h`
        }
        const summaryLine = session.playerName
          ? `${tableName} · ${durationLabel(finalRoundedMs)} · ${session.playerName}`
          : `${tableName} · ${durationLabel(finalRoundedMs)}`
        return (
          <>
            {coinConfig.coinsEnabled && linkedCustomer && coinConfig.coinRedemptionModes !== 'canteen' && (
              <div className="fixed bottom-24 left-0 right-0 px-4 z-40">
                <CoinRedemptionPill
                  customer={linkedCustomer}
                  config={coinConfig}
                  maxApplicable={finalGrandTotal}
                  applied={coinsApplied}
                  onChange={(coins, rupees) => {
                    setCoinsApplied(coins)
                    setCoinDiscount(rupees)
                  }}
                />
              </div>
            )}
            <PaymentSplitSheet
              open={splitSheetOpen}
              total={finalGrandTotal - coinDiscount}
              headline={summaryLine}
              initialCustomer={linkedCustomer}
              onCustomerLinked={(c) => setLinkedCustomer(c)}
              prepaidAdvance={prepaidAdvance}
              onCancel={() => {
                setSplitSheetOpen(false)
                if (session.paymentInProgress) {
                  void handleCancelPayment()
                }
              }}
              onConfirm={async (breakdown, customerId) => {
                const effectiveSessionId = session.id!
                const effectiveCustomerId = customerId ?? linkedCustomer?.id ?? null
                if (coinsApplied > 0 && linkedCustomer) {
                  await redeemCoins({
                    customerId: linkedCustomer.id,
                    coins: coinsApplied,
                    rupeeEquivalent: coinDiscount,
                    referenceType: 'coin_redemption',
                    referenceId: String(effectiveSessionId),
                  })
                }
                // P1e: when a booking advance was applied, the sheet collected
                // only `grandTotal − advance` from the customer. To keep the
                // confirmPaymentAndStop invariant honest (cash+upi+wallet ===
                // grandTotal), we first credit the full advance to the
                // customer's wallet (one ledger row), then route the consumed
                // portion through the breakdown's `wallet` leg. Net effect:
                //   surplus = max(0, advance − grandTotal) stays in wallet
                //   consumed = min(advance, grandTotal) was paid via wallet
                let writeBreakdown = breakdown
                if (linkedBooking && prepaidAdvance > 0 && effectiveCustomerId) {
                  const grand = finalGrandTotal - coinDiscount
                  const consumed = Math.min(grand, prepaidAdvance)
                  await creditBookingAdvanceRemainder({
                    customerId: effectiveCustomerId,
                    amount: prepaidAdvance,
                    bookingId: linkedBooking.id,
                  })
                  writeBreakdown = {
                    cash: breakdown.cash,
                    upi: breakdown.upi,
                    wallet: breakdown.wallet + consumed,
                  }
                }
                await confirmPaymentAndStop(
                  effectiveSessionId,
                  writeBreakdown,
                  effectiveCustomerId ?? undefined,
                )
                setSplitSheetOpen(false)
                setBreakdownRecorded(true)
                setConfirmedBreakdown(writeBreakdown)
                if (effectiveCustomerId) {
                  checkAndAwardStreak(effectiveCustomerId)
                    .then(({ awarded, coins, customerName }) => {
                      if (awarded) {
                        showToast({
                          message: `🪙 Streak bonus! ${customerName ?? 'Customer'} earned ${coins} ClubCoins for visiting multiple days this week.`,
                          durationMs: 4000,
                        })
                      }
                    })
                    .catch(() => {/* streak failure is non-critical */})
                }
              }}
            />
          </>
        )
      })()}
    </div>
  )
}
