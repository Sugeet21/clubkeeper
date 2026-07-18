import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PlayerScanLayout from './PlayerScanLayout'
import { UpiQrCard } from '../../components/UpiQrCard'
import {
  getClubPublicInfo,
  submitBookingIntent,
  getBookingIntentStatus,
  cancelBookingIntent,
  getBookedSlots,
} from '../../lib/playerHubApi'
import type { ClubPublicInfo, PublicTableInfo } from '../../types/playerHub'

// Player-side advance booking flow. Sibling to PlayerScan (topup) — reuses the
// same UPI/QR/8s-delay/3s-poll/10-min-expire machinery verbatim. Hybrid model:
// player INSERTs a row in Supabase booking_intents (via security-definer RPC),
// then polls get_booking_intent_status until the owner confirms or rejects.
//
// Pattern T1: all internal time math uses Unix ms. ISO strings only at the
// Supabase RPC boundary (timestamptz column). Pattern F7: inline errors only.
// Pattern P1: player does NOT recompute owner-derived values — tier price,
// advance, and confirm decision all originate from owner side or the RPC.

const GAME_LABELS: Record<string, string> = {
  pool: 'Pool',
  snooker: 'Snooker',
  carrom: 'Carrom',
  playstation: 'PlayStation',
  other: 'Other',
}

const FALLBACK_DURATION_MINS = [30, 60, 90, 120]
const SLOT_STEP_MIN = 30
const NEXT_DAY_COUNT = 7

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function formatTime(hour: number, min: number): string {
  // 12-hour clock with AM/PM — matches the rest of the app
  const period = hour < 12 || hour === 24 ? 'AM' : 'PM'
  const displayHour = hour === 0 || hour === 24 ? 12 : hour > 12 ? hour - 12 : hour
  return `${displayHour}:${pad2(min)} ${period}`
}

function formatDateChip(d: Date): { day: string; date: string; full: string } {
  const dayName = d.toLocaleDateString('en-IN', { weekday: 'short' })
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const full = d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return { day: dayName, date, full }
}

function pricePerMinuteFromHourly(ratePerHour: number, minutes: number): number {
  return Math.round((ratePerHour * minutes) / 60)
}

interface DurationOption {
  minutes: number
  price: number
}

function durationsForTable(t: PublicTableInfo): DurationOption[] {
  if (Array.isArray(t.rateCard) && t.rateCard.length > 0) {
    return t.rateCard.map((tier) => ({ minutes: tier.minutes, price: tier.price }))
  }
  return FALLBACK_DURATION_MINS.map((m) => ({
    minutes: m,
    price: pricePerMinuteFromHourly(t.ratePerHour, m),
  }))
}

/** Build the next 7 days, anchored at LOCAL midnight to avoid timezone drift. */
function buildNextDays(): { date: Date; label: ReturnType<typeof formatDateChip>; isToday: boolean }[] {
  const out: { date: Date; label: ReturnType<typeof formatDateChip>; isToday: boolean }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < NEXT_DAY_COUNT; i += 1) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    out.push({ date: d, label: formatDateChip(d), isToday: i === 0 })
  }
  return out
}

/**
 * Time options for the chosen calendar day, in 30-min steps inside
 * [openMin, closeMin - 30] (inclusive of last legal start). closeMin > 1440
 * = next-day close — those late-night slots are tagged "late-night" and land
 * under the same date header for v1 simplicity. For TODAY, drops any step
 * whose start <= now. Returns Unix ms; render formats.
 */
function buildTimeOptions(
  date: Date,
  now: number,
  openMin: number,
  closeMin: number,
): { ms: number; label: string; lateNight: boolean }[] {
  const out: { ms: number; label: string; lateNight: boolean }[] = []
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const lastStart = closeMin - SLOT_STEP_MIN
  for (let m = openMin; m <= lastStart; m += SLOT_STEP_MIN) {
    const ms = dayStart.getTime() + m * 60_000
    if (ms <= now) continue
    const lateNight = m >= 1440
    const t = new Date(ms)
    out.push({ ms, label: formatTime(t.getHours(), t.getMinutes()), lateNight })
  }
  return out
}

type Step = 'gameType' | 'table' | 'date' | 'time' | 'duration' | 'summary'

type PageState =
  | 'loading'
  | 'club_not_found'
  | 'bookings_disabled'
  | 'not_configured'
  | 'no_tables'
  | 'form'
  | 'submitting'
  | 'awaiting_payment'
  | 'waiting_confirm'
  | 'confirmed'
  | 'cancelling'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'error'

// Player cancellation window — must match server-side check in
// cancel_booking_intent (20260618_booking_cancel.sql). >2h before slot_start
// allows cancel; otherwise the button is hidden.
const CANCEL_CUTOFF_MS = 2 * 60 * 60 * 1000

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="border-2 border-accent border-t-transparent rounded-full animate-spin"
      style={{ width: size, height: size }}
    />
  )
}

export default function BookingScreen() {
  const { clubSlug } = useParams<{ clubSlug: string }>()
  const navigate = useNavigate()

  const [pageState, setPageState] = useState<PageState>('loading')
  const [clubInfo, setClubInfo] = useState<ClubPublicInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Wizard state
  const [step, setStep] = useState<Step>('gameType')
  const [gameType, setGameType] = useState<string | null>(null)
  const [tableId, setTableId] = useState<string | null>(null)   // v20+ (#127): UUID string, never Number() it (Pattern R5)
  const [dateMs, setDateMs] = useState<number | null>(null)       // midnight ms of chosen day
  const [slotStartMs, setSlotStartMs] = useState<number | null>(null)
  const [durationMin, setDurationMin] = useState<number | null>(null)
  const [tierPrice, setTierPrice] = useState<number | null>(null)

  // Form
  const [playerName, setPlayerName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)

  // Intent tracking
  const [intentId, setIntentId] = useState<string | null>(null)
  const [payBtnEnabled, setPayBtnEnabled] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  // Cancel-flow state — inline error shown on the confirmed screen if the
  // server rejects (e.g. raced past the 2h cutoff after the button rendered).
  const [cancelError, setCancelError] = useState<string | null>(null)

  // #90: Booked slots for the currently chosen (table, date). [start,end] in
  // Unix ms. Fetched once per (table, date) change via the effect below. The
  // initial empty array means "no blockers known" — server-side slot_taken
  // remains the safety net.
  const [bookedRanges, setBookedRanges] = useState<
    { start: number; end: number; status: 'pending' | 'confirmed' }[]
  >([])

  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (expireRef.current) { clearTimeout(expireRef.current); expireRef.current = null }
  }, [])

  // ── Load club info ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clubSlug) { setPageState('club_not_found'); return }
    getClubPublicInfo(clubSlug)
      .then((info) => {
        if (!info) { setPageState('club_not_found'); return }
        if (!info.acceptsBookings) { setPageState('bookings_disabled'); return }
        // #106: NO hardcoded fallback. If hours aren't configured the player
        // sees a "not configured" state and is told to contact the club.
        if (info.bookingOpenMinutes === null || info.bookingCloseMinutes === null) {
          setClubInfo(info)
          setPageState('not_configured')
          return
        }
        // Defensive read (Part A, #127): drop any table missing an id. Post-v20
        // GameTable.id is a UUID **string** (Post-v20 ID law) — validity = a
        // non-empty string. NEVER Number() it (Pattern R5). Without id we cannot
        // safely submit a booking. If ALL are missing → setup-in-progress state
        // instead of a broken picker. Log once for diagnosis.
        const hasValidId = (t: PublicTableInfo): boolean =>
          typeof t.id === 'string' && t.id.length > 0
        const bookable = info.tablesJson.filter(hasValidId)
        if (bookable.length !== info.tablesJson.length) {
          // eslint-disable-next-line no-console
          console.warn(
            '[booking] %d table(s) skipped — missing id (stale tables_json row, owner needs to re-save):',
            info.tablesJson.length - bookable.length,
            info.tablesJson.filter((t) => !hasValidId(t)).map((t) => t.name),
          )
        }
        if (bookable.length === 0) {
          setClubInfo(info)
          setPageState('no_tables')
          return
        }
        setClubInfo({ ...info, tablesJson: bookable })
        setPageState('form')
      })
      .catch(() => {
        setErrorMsg('Could not load club. Check your internet.')
        setPageState('error')
      })
  }, [clubSlug])

  // ── #90: Fetch booked slots whenever (table, date) is set ─────────────────
  useEffect(() => {
    if (!clubSlug || !tableId || dateMs === null) {
      setBookedRanges([])
      return
    }
    const dayStart = new Date(dateMs)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dateMs)
    dayEnd.setHours(23, 59, 59, 999)
    let cancelled = false
    getBookedSlots({
      slug: clubSlug,
      tableId,
      dayStartIso: dayStart.toISOString(),
      dayEndIso: dayEnd.toISOString(),
    })
      .then((rows) => {
        if (cancelled) return
        setBookedRanges(
          rows.map((r) => ({
            start: new Date(r.slotStartIso).getTime(),
            end: new Date(r.slotEndIso).getTime(),
            status: r.status,
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setBookedRanges([])
      })
    return () => { cancelled = true }
  }, [clubSlug, tableId, dateMs])

  // ── 8s delay on "I've paid" button (matches PlayerScan) ───────────────────
  useEffect(() => {
    if (pageState !== 'awaiting_payment') { setPayBtnEnabled(false); setElapsed(0); return }
    setPayBtnEnabled(false)
    const t = setTimeout(() => setPayBtnEnabled(true), 8000)
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => { clearTimeout(t); clearInterval(tick) }
  }, [pageState])

  // ── 3s polling loop with 10-min expire ────────────────────────────────────
  useEffect(() => {
    if (pageState !== 'waiting_confirm' || !intentId) return
    let mounted = true

    pollRef.current = setInterval(async () => {
      try {
        const result = await getBookingIntentStatus(intentId)
        if (!mounted || !result) return
        if (result.status === 'confirmed') {
          stopPolling()
          setPageState('confirmed')
        } else if (result.status === 'rejected') {
          stopPolling()
          setPageState('rejected')
        } else if (result.status === 'expired') {
          stopPolling()
          setPageState('expired')
        }
      } catch { /* ignore transient errors */ }
    }, 3000)

    expireRef.current = setTimeout(() => {
      if (!mounted) return
      stopPolling()
      setPageState('expired')
    }, 10 * 60 * 1000)

    return () => { mounted = false; stopPolling() }
  }, [pageState, intentId, stopPolling])

  // ── Derived data per current selection ────────────────────────────────────
  const gameTypes = useMemo(() => {
    if (!clubInfo) return []
    const seen: string[] = []
    for (const t of clubInfo.tablesJson) {
      if (!seen.includes(t.gameType)) seen.push(t.gameType)
    }
    return seen
  }, [clubInfo])

  const tablesForGameType = useMemo(() => {
    if (!clubInfo || !gameType) return []
    return clubInfo.tablesJson.filter((t) => t.gameType === gameType)
  }, [clubInfo, gameType])

  const selectedTable = useMemo<PublicTableInfo | null>(() => {
    if (!tableId || !clubInfo) return null
    return clubInfo.tablesJson.find((t) => t.id === tableId) ?? null
  }, [tableId, clubInfo])

  const dayChips = useMemo(buildNextDays, [])

  const selectedDate = useMemo<Date | null>(() => {
    if (dateMs === null) return null
    return new Date(dateMs)
  }, [dateMs])

  const timeOptions = useMemo(() => {
    if (!selectedDate || !clubInfo) return []
    if (clubInfo.bookingOpenMinutes === null || clubInfo.bookingCloseMinutes === null) return []
    return buildTimeOptions(
      selectedDate,
      Date.now(),
      clubInfo.bookingOpenMinutes,
      clubInfo.bookingCloseMinutes,
    )
  }, [selectedDate, clubInfo])

  // #90: A 30-min step is blocked if any booked range overlaps its
  // [ms, ms+30min) window. #147 (D-Booking-2): pending soft holds block too
  // but render differently — a confirmed overlap wins when both exist.
  function stepHoldStatus(ms: number): 'pending' | 'confirmed' | null {
    const stepEnd = ms + SLOT_STEP_MIN * 60 * 1000
    let hold: 'pending' | 'confirmed' | null = null
    for (const r of bookedRanges) {
      if (r.start < stepEnd && r.end > ms) {
        if (r.status === 'confirmed') return 'confirmed'
        hold = 'pending'
      }
    }
    return hold
  }

  // #90: For the chosen slotStart, the longest selectable duration is capped
  // by the next booked range's start time (if any). Returns minutes, or null
  // if no cap. Durations longer than the cap are disabled in step 'duration'.
  function maxDurationMinFromSlotStart(startMs: number): number | null {
    let nextBookedStart: number | null = null
    for (const r of bookedRanges) {
      if (r.start >= startMs) {
        if (nextBookedStart === null || r.start < nextBookedStart) {
          nextBookedStart = r.start
        }
      }
    }
    if (nextBookedStart === null) return null
    return Math.max(0, Math.floor((nextBookedStart - startMs) / 60000))
  }

  const durationOptions = useMemo<DurationOption[]>(() => {
    if (!selectedTable) return []
    return durationsForTable(selectedTable)
  }, [selectedTable])

  const maxDurationCap = useMemo<number | null>(() => {
    if (slotStartMs === null) return null
    return maxDurationMinFromSlotStart(slotStartMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotStartMs, bookedRanges])

  const slotEndMs = useMemo<number | null>(() => {
    if (slotStartMs === null || durationMin === null) return null
    return slotStartMs + durationMin * 60 * 1000
  }, [slotStartMs, durationMin])

  // #106: per-slot advance. Final advance = ceil(durationMin / 30) * perSlot.
  const perSlotAdvance = clubInfo?.bookingAdvancePerSlot ?? 50
  const slotsBooked = durationMin === null ? 0 : Math.ceil(durationMin / 30)
  const advanceAmount = slotsBooked * perSlotAdvance

  // ── Validation helpers ────────────────────────────────────────────────────
  function validateForm(): boolean {
    let ok = true
    setNameError(null)
    setPhoneError(null)
    if (playerName.trim().length > 30) { setNameError('Name must be 30 characters or less'); ok = false }
    const p = phone.trim()
    if (!p) { setPhoneError('Phone number is required'); ok = false }
    else if (!/^[6-9]\d{9}$/.test(p)) { setPhoneError('Enter a valid 10-digit Indian mobile number'); ok = false }
    return ok
  }

  function isFormValid(): boolean {
    if (phone.trim().length !== 10 || !/^[6-9]\d{9}$/.test(phone.trim())) return false
    if (playerName.trim().length > 30) return false
    return true
  }

  // ── Wizard navigation ─────────────────────────────────────────────────────
  function pickGameType(g: string) {
    setGameType(g)
    setTableId(null)
    setDateMs(null)
    setSlotStartMs(null)
    setDurationMin(null)
    setTierPrice(null)
    setStep('table')
  }

  function pickTable(id: string) {
    setTableId(id)
    setDateMs(null)
    setSlotStartMs(null)
    setDurationMin(null)
    setTierPrice(null)
    setStep('date')
  }

  function pickDate(ms: number) {
    setDateMs(ms)
    setSlotStartMs(null)
    setDurationMin(null)
    setStep('time')
  }

  function pickTime(ms: number) {
    setSlotStartMs(ms)
    setDurationMin(null)
    setStep('duration')
  }

  function pickDuration(opt: DurationOption) {
    setDurationMin(opt.minutes)
    setTierPrice(opt.price)
    setStep('summary')
  }

  function goBackStep() {
    if (step === 'table') setStep('gameType')
    else if (step === 'date') setStep('table')
    else if (step === 'time') setStep('date')
    else if (step === 'duration') setStep('time')
    else if (step === 'summary') setStep('duration')
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateForm() || !clubSlug) return
    if (
      !clubInfo ||
      !selectedTable ||
      selectedTable.id === undefined ||
      slotStartMs === null ||
      durationMin === null ||
      tierPrice === null
    ) {
      // Should be unreachable — defensive guard against stale state.
      setErrorMsg('Something went wrong. Please start over.')
      setPageState('error')
      return
    }
    setPageState('submitting')
    try {
      const id = await submitBookingIntent({
        slug: clubSlug,
        tableId: selectedTable.id,
        tableName: selectedTable.name,
        gameType: selectedTable.gameType,
        playerName: playerName.trim(),
        playerPhone: phone.trim(),
        slotStartIso: new Date(slotStartMs).toISOString(),
        durationMin,
        tierPrice,
        advanceAmount,
      })
      setIntentId(id)
      setPageState('awaiting_payment')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'club_not_found') { setPageState('club_not_found'); return }
      if (msg === 'bookings_disabled') { setPageState('bookings_disabled'); return }
      if (msg === 'slot_in_past') {
        setErrorMsg('That time has already passed. Pick another slot.')
        setStep('time'); setPageState('form'); return
      }
      if (msg === 'slot_taken') {
        setErrorMsg('This slot was just booked by someone else. Pick another.')
        setStep('time'); setPageState('form'); return
      }
      if (msg === 'rate_limited') {
        setPhoneError('Please wait a few minutes before trying again.')
        setPageState('form'); return
      }
      // #106: Server-side recompute mismatch or outside-hours rejection.
      // Either is a UX-layer issue (stale config / out-of-window slot) — show
      // inline and bounce the user back to the relevant step.
      if (msg === 'advance_mismatch') {
        setErrorMsg('Pricing changed. Please retry.')
        setStep('summary'); setPageState('form'); return
      }
      if (msg === 'outside_hours') {
        setErrorMsg('That time is outside this club’s booking hours. Pick another slot.')
        setStep('time'); setPageState('form'); return
      }
      if (msg === 'hours_not_set') {
        setPageState('not_configured'); return
      }
      setErrorMsg('Something went wrong. Please try again.')
      setPageState('form')
    }
  }

  // P1e-2: cancel button visible only when now < slotStart - 2h. Server
  // re-checks the same window — UI gate is a UX nicety, not a security check.
  const canCancel =
    slotStartMs !== null && intentId !== null && Date.now() < slotStartMs - CANCEL_CUTOFF_MS

  async function handleCancel() {
    if (!intentId || !canCancel) return
    setCancelError(null)
    setPageState('cancelling')
    try {
      await cancelBookingIntent({ intentId, playerPhone: phone.trim() })
      setPageState('cancelled')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'too_late') {
        setCancelError('Too late to cancel — please contact the club directly.')
      } else if (msg === 'invalid_status') {
        setCancelError('This booking can no longer be cancelled here.')
      } else if (msg === 'not_found') {
        setCancelError('Booking not found. Please contact the club.')
      } else {
        setCancelError('Could not cancel. Please try again.')
      }
      setPageState('confirmed')
    }
  }

  const shortCode = intentId ? `CK-${intentId.slice(-6).toUpperCase()}` : ''
  const upiNote = `BOOK-${intentId ? intentId.slice(-6).toUpperCase() : 'PAY'}`

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
          <Spinner size={32} />
          <p className="text-text-dim text-sm">Loading club info…</p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'error') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text font-semibold">{errorMsg ?? 'Something went wrong'}</p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl"
          >
            Back
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'club_not_found') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text-dim text-[15px]">This QR code is not active.</p>
          <p className="text-text-faint text-sm">Please ask the staff for assistance.</p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'bookings_disabled') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text-dim text-[15px]">Bookings are currently not accepted at this club.</p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl mt-2"
          >
            Back to top-up
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'not_configured') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text font-semibold text-[17px]">Bookings not configured yet</p>
          <p className="text-text-dim text-[14px]">
            Ask the club to set their opening &amp; closing hours, then try again.
          </p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl mt-2"
          >
            Back
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'no_tables') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text-dim text-[15px]">Booking is being set up. Check back shortly.</p>
          <p className="text-text-faint text-sm">Or speak to staff to book this time.</p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl mt-2"
          >
            Back
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if ((pageState === 'confirmed' || pageState === 'cancelling') && selectedTable && slotEndMs !== null && slotStartMs !== null && durationMin !== null) {
    const cancelling = pageState === 'cancelling'
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-free/12 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-free">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-[22px] font-bold text-text">Booking confirmed</p>
            <p className="text-text-dim text-sm mt-1">at {clubInfo?.clubName ?? 'the club'}</p>
          </div>
          <div className="bg-bg-card border border-border rounded-2xl px-5 py-4 w-full text-left space-y-2">
            <Row label="Table" value={`${selectedTable.name} (${GAME_LABELS[selectedTable.gameType] ?? selectedTable.gameType})`} />
            <Row label="Date" value={selectedDate ? formatDateChip(selectedDate).full : ''} />
            <Row
              label="Time"
              value={`${formatTime(new Date(slotStartMs).getHours(), new Date(slotStartMs).getMinutes())} – ${formatTime(new Date(slotEndMs).getHours(), new Date(slotEndMs).getMinutes())}`}
            />
            <Row label="Duration" value={`${durationMin} min`} />
            <Row label="Advance paid" value={formatRupees(advanceAmount)} />
          </div>
          <div className="bg-accent/8 border border-accent/30 rounded-2xl px-5 py-4 w-full">
            <p className="text-accent font-bold text-[15px]">Show this to staff when you arrive</p>
            <p className="text-text-faint text-[11px] font-mono uppercase tracking-widest mt-2">Reference</p>
            <p className="text-accent font-mono font-bold text-xl tracking-wider">{shortCode}</p>
            <p className="text-text-dim text-[13px] mt-2">
              {playerName.trim() || '(no name)'} · {phone.replace(/(\d{5})(\d{5})/, '$1 $2')}
            </p>
          </div>

          {/* P1e-2: Cancel button — visible only > 2h before slot_start.
              Inside the 2h cutoff we hide the button entirely and show a
              static notice so the player understands cancellation isn't
              automatic anymore. */}
          {canCancel ? (
            <div className="w-full flex flex-col gap-2">
              {cancelError && (
                <p className="text-busy text-[13px] text-left">{cancelError}</p>
              )}
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className={`w-full min-h-[48px] rounded-2xl border text-[14px] font-semibold transition-opacity ${
                  cancelling
                    ? 'bg-busy/8 border-busy/30 text-busy/60 cursor-not-allowed'
                    : 'bg-busy/8 border-busy/40 text-busy'
                }`}
              >
                {cancelling ? 'Cancelling…' : 'Cancel booking & refund advance to wallet'}
              </button>
              <p className="text-text-faint text-[11px]">
                Cancellation is allowed up to 2 hours before your slot. Advance is credited back to your wallet at this club.
              </p>
            </div>
          ) : (
            <p className="text-text-faint text-[12px] text-center">
              Cancellation closes 2 hours before slot. Contact the club to cancel late.
            </p>
          )}
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'cancelled') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-busy/12 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-busy">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <p className="text-[18px] font-bold text-text">Booking cancelled</p>
          <p className="text-text-dim text-sm">
            Your advance of {formatRupees(advanceAmount)} has been refunded to your wallet at {clubInfo?.clubName ?? 'the club'}.
          </p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl mt-2"
          >
            Back
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'rejected') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-busy/12 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-busy">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <p className="text-[18px] font-bold text-text">Booking rejected</p>
          <p className="text-text-dim text-sm">Sorry, the club couldn't confirm this slot.</p>
          <button
            onClick={() => clubSlug && navigate(`/c/${clubSlug}`)}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl mt-2"
          >
            Back
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'expired') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-[18px] font-bold text-text">Booking request expired</p>
          <p className="text-text-dim text-sm">Please try again.</p>
          <button
            onClick={() => { stopPolling(); setIntentId(null); setPageState('form'); setStep('summary') }}
            className="min-h-[44px] px-6 bg-accent text-bg font-bold rounded-2xl"
          >
            Try again
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'waiting_confirm') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-6 py-8 text-center">
          <Spinner size={40} />
          <div>
            <p className="text-[17px] font-bold text-text">Waiting for staff to confirm your booking…</p>
            <p className="text-text-dim text-sm mt-2">This usually takes under a minute.</p>
          </div>
          <div className="bg-bg-card border border-border rounded-2xl px-5 py-4 w-full">
            <p className="text-text-faint text-[11px] font-mono uppercase tracking-widest mb-1">Show this to staff</p>
            <p className="text-accent font-mono font-bold text-2xl tracking-wider">{shortCode}</p>
          </div>
          <p className="text-text-faint text-[12px]">Request will expire in 10 minutes.</p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'awaiting_payment') {
    const secondsLeft = Math.max(0, 8 - elapsed)
    const upiDeepLink = clubInfo?.upiId
      ? `upi://pay?pa=${encodeURIComponent(clubInfo.upiId)}&pn=${encodeURIComponent(clubInfo.clubName)}&am=${advanceAmount}&tn=${encodeURIComponent(upiNote)}&cu=INR`
      : null

    return (
      <PlayerScanLayout>
        <div className="flex flex-col gap-5">
          <div className="bg-free/8 border border-free/30 rounded-2xl px-4 py-3 flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-free shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-free font-semibold text-[14px]">Step 1 of 2 complete</p>
          </div>

          <div className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col items-center gap-4">
            <p className="text-[12px] font-mono text-text-faint uppercase tracking-widest">Advance to pay</p>
            <p className="text-[26px] font-bold font-mono text-text -mt-2">{formatRupees(advanceAmount)}</p>

            {upiDeepLink ? (
              <>
                <a
                  href={upiDeepLink}
                  className="block w-full bg-green-500 text-black font-bold text-[17px] py-4 rounded-2xl text-center"
                >
                  Pay {formatRupees(advanceAmount)} with UPI
                </a>
                <p className="text-[12px] text-text-faint text-center -mt-2">
                  Opens GPay, PhonePe, Paytm, or any UPI app
                </p>
                <details className="w-full">
                  <summary className="text-[13px] text-text-faint cursor-pointer text-center">
                    Or scan from another device
                  </summary>
                  <div className="mt-3 flex justify-center">
                    <UpiQrCard
                      amount={advanceAmount}
                      upiId={clubInfo!.upiId!}
                      payeeName={clubInfo!.clubName}
                      transactionNote={upiNote}
                    />
                  </div>
                </details>
              </>
            ) : (
              <div className="bg-paused/8 border border-paused/30 rounded-2xl px-5 py-4 w-full text-center">
                <p className="text-paused font-semibold">Pay {formatRupees(advanceAmount)} cash to staff</p>
              </div>
            )}

            <div className="w-full bg-bg border border-border rounded-2xl px-4 py-2 text-center">
              <p className="text-text-faint text-[11px] font-mono uppercase tracking-widest">Reference code</p>
              <p className="text-accent font-mono font-bold text-lg tracking-widest">{shortCode}</p>
            </div>
          </div>

          <button
            onClick={() => setPageState('waiting_confirm')}
            disabled={!payBtnEnabled}
            className={`w-full min-h-[52px] rounded-2xl font-bold text-[16px] transition-opacity ${
              payBtnEnabled ? 'bg-accent text-bg' : 'bg-accent/40 text-bg/60 cursor-not-allowed'
            }`}
          >
            {payBtnEnabled ? "I've paid — notify staff" : `I've paid (${secondsLeft}s)`}
          </button>
          <p className="text-text-faint text-[12px] text-center">
            The button enables after 8 seconds so payment completes before we notify.
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  // ── Wizard (form) ────────────────────────────────────────────────────────
  return (
    <PlayerScanLayout>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div>
          <button
            onClick={() => step === 'gameType' ? (clubSlug && navigate(`/c/${clubSlug}`)) : goBackStep()}
            className="text-text-faint text-[13px] mb-2 flex items-center gap-1 min-h-[32px]"
          >
            <span>←</span>
            <span>Back</span>
          </button>
          <p className="text-text-faint text-[12px] font-mono uppercase tracking-widest mb-1">
            {clubInfo?.clubName ?? 'Club'}
          </p>
          <h1 className="text-[24px] font-bold text-text">Book a table</h1>
          <p className="text-text-dim text-sm mt-1">
            {step === 'gameType' && 'What game?'}
            {step === 'table' && 'Pick a table'}
            {step === 'date' && 'Pick a day'}
            {step === 'time' && 'Pick a start time'}
            {step === 'duration' && 'How long?'}
            {step === 'summary' && 'Confirm your booking'}
          </p>
        </div>

        {/* Inline transient error (slot_in_past / slot_taken / submit fail) */}
        {errorMsg && pageState === 'form' && (
          <div className="bg-busy/10 border border-busy/30 rounded-xl px-3 py-2 text-busy text-[13px]">
            {errorMsg}
          </div>
        )}

        {step === 'gameType' && (
          <div className="flex flex-wrap gap-2">
            {gameTypes.map((g) => (
              <button
                key={g}
                onClick={() => pickGameType(g)}
                className="min-h-[52px] px-6 rounded-2xl bg-bg-card border border-border text-text font-semibold text-[15px]"
              >
                {GAME_LABELS[g] ?? g}
              </button>
            ))}
          </div>
        )}

        {step === 'table' && (
          <div className="flex flex-col gap-2">
            {tablesForGameType.map((t) => (
              <button
                key={t.id}
                onClick={() => typeof t.id === 'string' && t.id.length > 0 && pickTable(t.id)}
                className="w-full text-left bg-bg-card border border-border rounded-2xl px-4 py-3.5 min-h-[52px]"
              >
                <p className="text-text font-semibold text-[15px]">{t.name}</p>
                <p className="text-text-faint text-[12px] mt-0.5">
                  {Array.isArray(t.rateCard) && t.rateCard.length > 0
                    ? `${t.rateCard.length} duration${t.rateCard.length > 1 ? 's' : ''} available`
                    : `${formatRupees(t.ratePerHour)}/hr`}
                </p>
              </button>
            ))}
          </div>
        )}

        {step === 'date' && (
          <div className="grid grid-cols-3 gap-2">
            {dayChips.map(({ date, label, isToday }) => (
              <button
                key={date.getTime()}
                onClick={() => pickDate(date.getTime())}
                className="min-h-[64px] bg-bg-card border border-border rounded-2xl px-2 py-2 flex flex-col items-center justify-center"
              >
                <p className="text-text-faint text-[11px] font-mono uppercase">{isToday ? 'Today' : label.day}</p>
                <p className="text-text font-semibold text-[14px] mt-0.5">{label.date}</p>
              </button>
            ))}
          </div>
        )}

        {step === 'time' && (
          <div>
            {timeOptions.length === 0 ? (
              <div className="bg-bg-card border border-border rounded-2xl px-4 py-6 text-center">
                <p className="text-text-dim text-[14px]">No more slots available today.</p>
                <button
                  onClick={() => setStep('date')}
                  className="mt-3 min-h-[44px] px-5 bg-accent text-bg font-bold rounded-2xl"
                >
                  Pick another day
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {timeOptions.map(({ ms, label, lateNight }) => {
                    const hold = stepHoldStatus(ms)
                    const booked = hold !== null
                    return (
                      <button
                        key={ms}
                        onClick={() => !booked && pickTime(ms)}
                        disabled={booked}
                        className={`min-h-[44px] rounded-xl text-[13px] font-mono flex flex-col items-center justify-center leading-tight ${
                          booked
                            ? 'bg-bg-card/40 border border-border/40 text-text-faint cursor-not-allowed'
                            : 'bg-bg-card border border-border text-text'
                        }`}
                      >
                        <span>{label}</span>
                        {hold === 'confirmed' ? (
                          <span className="text-[9px] uppercase tracking-widest text-busy mt-0.5">
                            Booked
                          </span>
                        ) : hold === 'pending' ? (
                          <span className="text-[9px] uppercase tracking-widest text-paused mt-0.5">
                            Pending
                          </span>
                        ) : lateNight ? (
                          <span className="text-[9px] uppercase tracking-widest text-text-faint mt-0.5">
                            Late-night
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
                {bookedRanges.some((r) => r.status === 'pending') && (
                  <p className="text-text-faint text-[12px] mt-3">
                    <span className="text-paused uppercase text-[10px] tracking-widest">Pending</span>{' '}
                    slots have a request awaiting approval — pick another slot.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {step === 'duration' && (
          <div className="flex flex-col gap-2">
            {durationOptions.map((opt) => {
              const overlaps = maxDurationCap !== null && opt.minutes > maxDurationCap
              return (
                <button
                  key={opt.minutes}
                  onClick={() => !overlaps && pickDuration(opt)}
                  disabled={overlaps}
                  className={`w-full rounded-2xl px-4 py-3.5 flex items-center justify-between min-h-[52px] border ${
                    overlaps
                      ? 'bg-bg-card/40 border-border/40 cursor-not-allowed'
                      : 'bg-bg-card border-border'
                  }`}
                >
                  <span className="flex flex-col items-start leading-tight">
                    <span className={`font-semibold text-[15px] ${overlaps ? 'text-text-faint' : 'text-text'}`}>
                      {opt.minutes} min
                    </span>
                    {overlaps && (
                      <span className="text-busy text-[11px] uppercase tracking-widest mt-0.5">
                        Overlaps next booking
                      </span>
                    )}
                  </span>
                  <span className={`font-bold text-[15px] font-mono ${overlaps ? 'text-text-faint' : 'text-accent'}`}>
                    {formatRupees(opt.price)}
                  </span>
                </button>
              )
            })}
            {maxDurationCap !== null && durationOptions.every((o) => o.minutes > maxDurationCap) && (
              <p className="text-text-faint text-[12px] mt-2">
                Only {maxDurationCap} min available before the next booking. Pick another start time.
              </p>
            )}
          </div>
        )}

        {step === 'summary' && selectedTable && slotStartMs !== null && slotEndMs !== null && durationMin !== null && tierPrice !== null && (
          <div className="flex flex-col gap-4">
            <div className="bg-bg-card border border-border rounded-2xl px-4 py-3 space-y-2">
              <Row label="Table" value={`${selectedTable.name} (${GAME_LABELS[selectedTable.gameType] ?? selectedTable.gameType})`} />
              <Row label="Date" value={selectedDate ? formatDateChip(selectedDate).full : ''} />
              <Row
                label="Time"
                value={`${formatTime(new Date(slotStartMs).getHours(), new Date(slotStartMs).getMinutes())} – ${formatTime(new Date(slotEndMs).getHours(), new Date(slotEndMs).getMinutes())}`}
              />
              <Row label="Duration" value={`${durationMin} min`} />
              <Row label="Tier price" value={formatRupees(tierPrice)} />
              <div className="border-t border-border pt-2 mt-2 flex items-center justify-between">
                <span className="text-accent text-[14px] font-semibold">Advance to pay now</span>
                <span className="text-accent text-[16px] font-bold font-mono">{formatRupees(advanceAmount)}</span>
              </div>
              <p className="text-text-faint text-[11px]">
                {slotsBooked} × 30 min slot{slotsBooked === 1 ? '' : 's'} @ {formatRupees(perSlotAdvance)}/slot.
                Pay the rest when you arrive. Advance is non-refundable if you don't show.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
                Your name (optional)
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => { setPlayerName(e.target.value); setNameError(null) }}
                placeholder="Rahul"
                className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
              />
              {nameError && <p className="text-busy text-[13px] mt-1.5">{nameError}</p>}
            </div>

            <div>
              <label className="block text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
                Mobile number <span className="text-busy">*</span>
              </label>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setPhoneError(null) }}
                placeholder="9876543210"
                className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint font-mono"
              />
              {phoneError && <p className="text-busy text-[13px] mt-1.5">{phoneError}</p>}
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isFormValid() || (pageState as string) === 'submitting'}
              className={`w-full min-h-[52px] rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 transition-opacity ${
                isFormValid() && (pageState as string) !== 'submitting'
                  ? 'bg-accent text-bg'
                  : 'bg-accent/40 text-bg/60 cursor-not-allowed'
              }`}
            >
              {(pageState as string) === 'submitting' ? (
                <>
                  <Spinner size={18} />
                  <span>Submitting…</span>
                </>
              ) : (
                `Pay ${formatRupees(advanceAmount)} advance`
              )}
            </button>
          </div>
        )}
      </div>
    </PlayerScanLayout>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-text-faint text-[12px] font-mono uppercase tracking-widest">{label}</span>
      <span className="text-text text-[14px] text-right">{value}</span>
    </div>
  )
}
