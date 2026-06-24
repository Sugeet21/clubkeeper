import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Check, X, AlertCircle, Coins, Calendar, IndianRupee } from 'lucide-react'
import PlayerScanLayout from './PlayerScanLayout'
import { PlayerUpiQrCard } from '../../components/player/PlayerUpiQrCard'
import { PlayerLoader } from '../../components/player/PlayerLoader'
import { getClubPublicInfo, submitTopupIntent, getTopupIntentStatus } from '../../lib/playerHubApi'
import type { ClubPublicInfo, PublicTableInfo } from '../../types/playerHub'
import { coinsEarnedForTopup } from '../../lib/coins'

// Player-side wallet top-up flow. Visually rebuilt against
// .claude/skills/clubkeeper/references/player_design_system.md. The state
// machine, validation, API calls, timers, refs, and polling cadence are
// unchanged from the prior implementation — this is a visual/UX refresh.
//
// Token naming reminder: player tokens are kebab-case in tailwind.config.js
// (text-player-cue-yellow, etc.). Do NOT camelCase them in JSX — Tailwind's
// slash-opacity parser doesn't tolerate camelCase keys.

const GAME_LABELS: Record<string, string> = {
  pool: 'Pool',
  snooker: 'Snooker',
  carrom: 'Carrom',
  playstation: 'PlayStation',
  other: 'Other',
}

function formatRupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}

function PricingCard({ tables }: { tables: PublicTableInfo[] }) {
  const [open, setOpen] = useState(false)

  const groups = new Map<string, PublicTableInfo[]>()
  for (const t of tables) {
    const arr = groups.get(t.gameType) ?? []
    arr.push(t)
    groups.set(t.gameType, arr)
  }

  return (
    <div className="bg-player-felt-deep border border-player-ball-white/15 rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 min-h-[48px] text-left focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/30 rounded"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-yellow">
          Rates
        </span>
        <span className="flex-1 font-body text-[14px] text-player-ball-white">View pricing</span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          className={`text-player-cue-cream/65 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-player-ball-white/15 space-y-5">
          {Array.from(groups.entries()).map(([gameType, list]) => (
            <div key={gameType}>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-yellow mb-3">
                {GAME_LABELS[gameType] ?? gameType}
              </p>
              <div className="space-y-3">
                {list.map((t, idx) => (
                  <PricingRow key={`${t.name}-${idx}`} table={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PricingRow({ table }: { table: PublicTableInfo }) {
  const hasCard = Array.isArray(table.rateCard) && table.rateCard.length > 0
  return (
    <div className="border-b border-player-ball-white/15 pb-3 last:border-b-0 last:pb-0">
      <p className="font-display font-bold text-[15px] text-player-ball-white">{table.name}</p>
      {hasCard ? (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {table.rateCard!.map((tier, i) => (
              <span key={i} className="font-mono text-[13px] text-player-cue-cream">
                {tier.minutes}m {formatRupees(tier.price)}
                {i < table.rateCard!.length - 1 && (
                  <span className="text-player-cue-cream/40 ml-3">·</span>
                )}
              </span>
            ))}
          </div>
          {table.toleranceMinutes !== undefined && table.toleranceMinutes > 0 && (
            <p className="font-body text-[12px] text-player-cue-cream/65 mt-1.5">
              {table.toleranceMinutes} min grace at every tier
            </p>
          )}
        </>
      ) : (
        <p className="font-mono text-[13px] text-player-cue-cream mt-1">
          {formatRupees(table.ratePerHour)}/hr
          {table.ratePerFrame !== undefined && (
            <span className="ml-2 text-player-cue-cream/65">
              · {formatRupees(table.ratePerFrame)}/frame
            </span>
          )}
        </p>
      )}
    </div>
  )
}

type PageState =
  | 'loading'
  | 'club_not_found'
  | 'topups_disabled'
  | 'form'
  | 'submitting'
  | 'awaiting_payment'
  | 'waiting_confirm'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'error'

const AMOUNT_CHIPS = [100, 200, 500, 1000]

export default function PlayerScan() {
  const { clubSlug } = useParams<{ clubSlug: string }>()
  const navigate = useNavigate()
  const [pageState, setPageState] = useState<PageState>('loading')
  const [clubInfo, setClubInfo] = useState<ClubPublicInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form fields
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [mobile, setMobile] = useState('')
  const [mobileError, setMobileError] = useState<string | null>(null)
  const [amount, setAmount] = useState<number>(500)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [customAmount, setCustomAmount] = useState('')

  // Intent tracking
  const [intentId, setIntentId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<string | null>(null)
  // Authoritative coin total from the server (owner-side computed, includes
  // welcome bonus + any future engagement bonus). Null when the legacy
  // confirmation path was used (intent confirmed before #87 shipped, or via
  // the failed-sync retry queue) — in that case we fall back to a local
  // tier-only computation. See Pattern P1.
  const [confirmedCoins, setConfirmedCoins] = useState<number | null>(null)
  const [payBtnEnabled, setPayBtnEnabled] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (expireRef.current) { clearTimeout(expireRef.current); expireRef.current = null }
  }, [])

  // Load club info on mount
  useEffect(() => {
    if (!clubSlug) { setPageState('club_not_found'); return }

    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 8000)

    getClubPublicInfo(clubSlug)
      .then((info) => {
        clearTimeout(timeout)
        if (!info) { setPageState('club_not_found'); return }
        if (!info.acceptsTopups) { setPageState('topups_disabled'); return }
        setClubInfo(info)
        setPageState('form')
      })
      .catch((e: unknown) => {
        clearTimeout(timeout)
        if (typeof e === 'object' && e !== null && 'name' in e && (e as { name: string }).name === 'AbortError') {
          setError('Could not reach club. Check your internet.')
        } else {
          setError('Could not load club. Check your internet.')
        }
        setPageState('error')
      })

    return () => { clearTimeout(timeout); ctrl.abort() }
  }, [clubSlug])

  // 8-second delay before enabling "I've paid" button
  useEffect(() => {
    if (pageState !== 'awaiting_payment') { setPayBtnEnabled(false); setElapsed(0); return }
    setPayBtnEnabled(false)
    const t = setTimeout(() => setPayBtnEnabled(true), 8000)
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => { clearTimeout(t); clearInterval(tick) }
  }, [pageState])

  // Polling loop for waiting_confirm
  useEffect(() => {
    if (pageState !== 'waiting_confirm' || !intentId) return

    let mounted = true

    pollRef.current = setInterval(async () => {
      try {
        const result = await getTopupIntentStatus(intentId)
        if (!mounted || !result) return
        if (result.status === 'confirmed') {
          stopPolling()
          setConfirmedCoins(result.coinsCredited)
          setPageState('confirmed')
        }
        else if (result.status === 'rejected') { stopPolling(); setRejectReason(result.rejectReason); setPageState('rejected') }
        else if (result.status === 'expired') { stopPolling(); setPageState('expired') }
      } catch { /* ignore transient errors */ }
    }, 5000)

    // 10-minute expire
    expireRef.current = setTimeout(() => {
      if (!mounted) return
      stopPolling()
      setPageState('expired')
    }, 10 * 60 * 1000)

    return () => { mounted = false; stopPolling() }
  }, [pageState, intentId, stopPolling])

  // ─── Validation ────────────────────────────────────────────────────────────

  function validateForm(): boolean {
    let ok = true
    setNameError(null)
    setMobileError(null)
    setAmountError(null)

    if (name.trim().length > 30) { setNameError('Name must be 30 characters or less'); ok = false }

    const mob = mobile.trim()
    if (!mob) { setMobileError('Mobile number is required'); ok = false }
    else if (!/^[6-9]\d{9}$/.test(mob)) { setMobileError('Enter a valid 10-digit Indian mobile number'); ok = false }

    if (!amount || amount < 100 || amount > 10000) { setAmountError('Amount must be between ₹100 and ₹10,000'); ok = false }

    return ok
  }

  function isFormValid(): boolean {
    if (mobile.trim().length !== 10 || !/^[6-9]\d{9}$/.test(mobile.trim())) return false
    if (name.trim().length > 30) return false
    if (!amount || amount < 100 || amount > 10000) return false
    return true
  }

  async function handleSubmit() {
    if (!validateForm() || !clubSlug) return
    setPageState('submitting')

    try {
      const id = await submitTopupIntent(
        clubSlug,
        name.trim(),
        mobile.trim(),
        amount,
      )
      setIntentId(id)
      setPageState('awaiting_payment')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : ''
      if (msg === 'club_not_found') { setPageState('club_not_found'); return }
      if (msg === 'topups_disabled') { setPageState('topups_disabled'); return }
      if (msg === 'rate_limited') {
        setMobileError('Please wait a few minutes before trying again.')
        setPageState('form')
        return
      }
      setMobileError('Something went wrong. Please try again.')
      setPageState('form')
    }
  }

  function handleAmountChip(val: number) {
    setAmount(val)
    setCustomAmount('')
    setAmountError(null)
  }

  function handleCustomAmount(val: string) {
    setCustomAmount(val)
    const n = parseInt(val, 10)
    if (!isNaN(n)) { setAmount(n); setAmountError(null) }
    else setAmount(0)
  }

  const shortCode = intentId ? `CK-${intentId.slice(-6).toUpperCase()}` : ''
  const upiNote = `CK-${intentId ? intentId.slice(-6).toUpperCase() : 'PAY'}`

  // ─── Render ────────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <PlayerScanLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <PlayerLoader variant="block" size={14} label="Loading…" />
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'error') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <AlertCircle size={32} strokeWidth={1.5} className="text-player-ball-red" aria-hidden />
          <p className="font-display text-[22px] font-bold text-player-ball-white">
            Couldn't load
          </p>
          <p className="font-body text-[14px] text-player-cue-cream/65 max-w-[280px]">
            {error ?? 'Something went wrong. Check your internet and try again.'}
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'club_not_found') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <p className="font-display text-[22px] font-bold text-player-ball-white">
            QR not active
          </p>
          <p className="font-body text-[14px] text-player-cue-cream/65 max-w-[280px]">
            This QR code isn't recognised. Please ask the staff for help.
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'topups_disabled') {
    return (
      <PlayerScanLayout clubName={clubInfo?.clubName}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <p className="font-display text-[22px] font-bold text-player-ball-white">
            Top-ups paused
          </p>
          <p className="font-body text-[14px] text-player-cue-cream/65 max-w-[280px]">
            This club isn't accepting top-ups right now. Please ask the staff to help.
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'confirmed') {
    return (
      <PlayerScanLayout clubName={clubInfo?.clubName}>
        <div className="flex flex-col items-center gap-6 py-6 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(45, 107, 58, 0.2)' }}
            aria-hidden
          >
            <Check size={32} strokeWidth={2.5} className="text-player-ball-green" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 mb-2">
              Top-up confirmed
            </p>
            <p className="font-mono text-[40px] font-bold text-player-cue-yellow leading-none">
              {formatRupees(amount)}
            </p>
            <p className="font-body text-[14px] text-player-cue-cream mt-3">
              added to your wallet at {clubInfo?.clubName ?? 'the club'}
            </p>
          </div>
          <div className="bg-player-felt-deep border border-player-ball-white/15 rounded p-5 w-full text-left">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 mb-1">
              Show this at the table
            </p>
            <p className="font-mono font-bold text-[22px] text-player-ball-white tracking-wide">
              {mobile.replace(/(\d{5})(\d{5})/, '$1 $2')}
            </p>
          </div>
          {clubInfo?.coinsEnabled && clubInfo.coinTiers.length > 0 && (() => {
            // Prefer the server-side authoritative total (includes welcome
            // bonus + any future engagement bonuses owner-side computes).
            // Fall back to a local tier-only computation only for legacy
            // intents confirmed before coins_credited shipped. See #87 /
            // Pattern P1.
            const coins = confirmedCoins ?? coinsEarnedForTopup(amount, clubInfo.coinTiers)
            if (coins <= 0) return null
            return (
              <div
                className="flex items-center justify-center gap-2 px-4 py-3 rounded w-full"
                style={{ background: 'rgba(244, 197, 66, 0.15)', border: '1px solid rgba(244, 197, 66, 0.35)' }}
              >
                <Coins size={18} strokeWidth={1.5} className="text-player-cue-yellow" aria-hidden />
                <span className="font-mono text-[14px] font-semibold text-player-cue-yellow">
                  +{coins.toLocaleString('en-IN')} ClubCoins credited
                </span>
              </div>
            )
          })()}
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'rejected') {
    return (
      <PlayerScanLayout clubName={clubInfo?.clubName}>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(184, 49, 42, 0.15)' }}
            aria-hidden
          >
            <X size={28} strokeWidth={2.5} className="text-player-ball-red" />
          </div>
          <p className="font-display text-[22px] font-bold text-player-ball-white">
            Top-up rejected
          </p>
          {rejectReason && (
            <p className="font-body text-[14px] text-player-cue-cream">{rejectReason}</p>
          )}
          <p className="font-body text-[13px] text-player-cue-cream/65 max-w-[280px]">
            Please speak to the staff. They can help sort this out.
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'expired') {
    return (
      <PlayerScanLayout clubName={clubInfo?.clubName}>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <p className="font-display text-[22px] font-bold text-player-ball-white">
            Request expired
          </p>
          <p className="font-body text-[14px] text-player-cue-cream/65 max-w-[280px]">
            This request expired after 10 minutes without confirmation.
          </p>
          <button
            onClick={() => { stopPolling(); setIntentId(null); setPageState('form') }}
            className="min-h-[48px] px-6 bg-player-cue-yellow text-player-felt-deep font-body font-semibold text-[15px] rounded tracking-wide focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/50 focus:ring-offset-2 focus:ring-offset-player-felt active:scale-[0.98] transition-transform"
          >
            Try again
          </button>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'waiting_confirm') {
    return (
      <PlayerScanLayout clubName={clubInfo?.clubName}>
        <div className="flex flex-col items-center gap-6 py-6 text-center">
          <PlayerLoader variant="block" size={14} label="Waiting for staff" />
          <div>
            <p className="font-display text-[22px] font-bold text-player-ball-white">
              Confirming your {formatRupees(amount)}
            </p>
            <p className="font-body text-[14px] text-player-cue-cream/65 mt-2 max-w-[280px]">
              Staff will mark this paid in under a minute.
            </p>
          </div>
          <div className="bg-player-felt-deep border-l-[3px] border-player-cue-yellow rounded-sm py-5 px-6 w-full">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 mb-2">
              Show this to staff
            </p>
            <p className="font-mono font-bold text-[28px] text-player-cue-yellow tracking-[0.08em]">
              {shortCode}
            </p>
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/40">
            Expires in 10 min
          </p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'awaiting_payment') {
    const secondsLeft = Math.max(0, 8 - elapsed)
    const upiDeepLink = clubInfo?.upiId
      ? `upi://pay?pa=${encodeURIComponent(clubInfo.upiId)}&pn=${encodeURIComponent(clubInfo.clubName)}&am=${amount}&tn=${encodeURIComponent(upiNote)}&cu=INR`
      : null

    return (
      <PlayerScanLayout clubName={clubInfo?.clubName} meta="STEP 2 OF 2">
        <div className="flex flex-col gap-6">
          {/* Step 1 complete */}
          <div
            className="flex items-center gap-3 px-4 py-3 rounded"
            style={{ background: 'rgba(45, 107, 58, 0.15)', border: '1px solid rgba(45, 107, 58, 0.4)' }}
          >
            <Check size={18} strokeWidth={2.5} className="text-player-ball-green shrink-0" aria-hidden />
            <p className="font-body text-[14px] font-medium text-player-ball-green">
              Details submitted — now pay
            </p>
          </div>

          {/* Amount hero + payment block */}
          <div className="bg-player-felt-deep border border-player-ball-white/15 rounded p-6 flex flex-col items-center gap-5">
            <div className="text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 mb-1">
                Amount to pay
              </p>
              <p className="font-mono font-bold text-[44px] text-player-cue-yellow leading-none tracking-tight">
                {formatRupees(amount)}
              </p>
            </div>

            {upiDeepLink ? (
              <>
                <a
                  href={upiDeepLink}
                  className="block w-full bg-player-cue-yellow text-player-felt-deep font-body font-semibold text-[15px] py-4 rounded text-center min-h-[48px] tracking-wide focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/50 focus:ring-offset-2 focus:ring-offset-player-felt-deep active:scale-[0.98] transition-transform"
                >
                  Pay {formatRupees(amount)} with UPI
                </a>
                <p className="font-body text-[12px] text-player-cue-cream/65 text-center -mt-1">
                  Opens GPay, PhonePe, Paytm, or any UPI app
                </p>
                <details className="w-full">
                  <summary className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 cursor-pointer text-center select-none list-none">
                    Or scan from another device
                  </summary>
                  <div className="mt-4 flex justify-center">
                    <PlayerUpiQrCard
                      amount={amount}
                      upiId={clubInfo!.upiId!}
                      payeeName={clubInfo!.clubName}
                      transactionNote={upiNote}
                    />
                  </div>
                </details>
              </>
            ) : (
              <div
                className="rounded p-4 w-full text-center"
                style={{ background: 'rgba(244, 197, 66, 0.15)', border: '1px solid rgba(244, 197, 66, 0.4)' }}
              >
                <p className="font-body font-semibold text-player-cue-yellow">
                  Pay {formatRupees(amount)} cash to staff
                </p>
              </div>
            )}

            <div className="w-full pt-4 border-t border-player-ball-white/15 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 mb-1">
                Reference code
              </p>
              <p className="font-mono font-bold text-[18px] text-player-cue-yellow tracking-[0.1em]">
                {shortCode}
              </p>
            </div>
          </div>

          {/* I've paid button */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setPageState('waiting_confirm')}
              disabled={!payBtnEnabled}
              className={`w-full min-h-[52px] rounded font-body font-semibold text-[15px] tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/50 focus:ring-offset-2 focus:ring-offset-player-felt ${
                payBtnEnabled
                  ? 'bg-player-cue-yellow text-player-felt-deep active:scale-[0.98]'
                  : 'bg-player-cue-yellow/40 text-player-felt-deep/60 cursor-not-allowed'
              }`}
            >
              {payBtnEnabled ? "I've paid — notify staff" : `I've paid (${secondsLeft}s)`}
            </button>
            <p className="font-body text-[12px] text-player-cue-cream/65 text-center">
              The button enables after 8s so payment lands before we notify.
            </p>
          </div>
        </div>
      </PlayerScanLayout>
    )
  }

  // ─── Form / submitting state ───────────────────────────────────────────────

  const submitting = pageState === 'submitting'
  const formValid = isFormValid()

  return (
    <PlayerScanLayout clubName={clubInfo?.clubName} meta="STEP 1 OF 2">
      {/* The page scrolls; primary CTA stays sticky at the bottom (design system §9). */}
      <div className="flex flex-col gap-6 pb-28">
        {/* Heading */}
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-yellow mb-2">
            Wallet
          </p>
          <h1 className="font-display font-bold text-[32px] leading-[1.05] text-player-ball-white">
            Top up your <em className="not-italic text-player-cue-yellow font-display italic">balance.</em>
          </h1>
          <p className="font-body text-[15px] text-player-cue-cream/80 mt-3 leading-relaxed">
            Pay over UPI. Staff confirms at the table.
          </p>
        </div>

        {/* Name (optional) */}
        <div>
          <label htmlFor="ck-name" className="block font-body text-[13px] font-medium text-player-cue-cream mb-2">
            Your name <span className="text-player-cue-cream/65 font-normal">(optional)</span>
          </label>
          <input
            id="ck-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null) }}
            placeholder="Rahul"
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? 'ck-name-err' : undefined}
            className="player-input w-full px-4 py-3.5 bg-player-felt-deep border border-player-ball-white/35 rounded text-player-ball-white text-[16px] font-body min-h-[48px] focus:outline-none focus:border-player-cue-yellow focus:ring-[3px] focus:ring-player-cue-yellow/15 placeholder:text-player-cue-cream/40"
          />
          {nameError && (
            <p id="ck-name-err" className="font-body text-[12px] text-player-ball-red mt-1.5">{nameError}</p>
          )}
        </div>

        {/* Mobile (required) */}
        <div>
          <label htmlFor="ck-mobile" className="block font-body text-[13px] font-medium text-player-cue-cream mb-2">
            Mobile number <span className="text-player-ball-red">*</span>
          </label>
          <input
            id="ck-mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            value={mobile}
            onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); setMobileError(null) }}
            placeholder="9876543210"
            aria-invalid={mobileError !== null}
            aria-describedby={mobileError ? 'ck-mobile-err' : 'ck-mobile-help'}
            className="player-input w-full px-4 py-3.5 bg-player-felt-deep border border-player-ball-white/35 rounded text-player-ball-white text-[16px] font-mono min-h-[48px] focus:outline-none focus:border-player-cue-yellow focus:ring-[3px] focus:ring-player-cue-yellow/15 placeholder:text-player-cue-cream/40 tracking-wider"
          />
          {mobileError ? (
            <p id="ck-mobile-err" className="font-body text-[12px] text-player-ball-red mt-1.5">{mobileError}</p>
          ) : (
            <p id="ck-mobile-help" className="font-body text-[12px] text-player-cue-cream/65 mt-1.5">
              Staff uses this to find your wallet at the table.
            </p>
          )}
        </div>

        {/* Amount */}
        <div>
          <label className="block font-body text-[13px] font-medium text-player-cue-cream mb-2">
            Amount <span className="text-player-ball-red">*</span>
          </label>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {AMOUNT_CHIPS.map((chip) => {
              const active = amount === chip && !customAmount
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleAmountChip(chip)}
                  aria-pressed={active}
                  className={`min-h-[48px] rounded font-mono font-semibold text-[14px] border transition-colors focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/30 ${
                    active
                      ? 'bg-player-felt-light text-player-cue-yellow border-player-cue-yellow'
                      : 'bg-player-felt-deep text-player-ball-white border-player-ball-white/35'
                  }`}
                >
                  ₹{chip}
                </button>
              )
            })}
          </div>
          <div className="relative">
            <IndianRupee
              size={16}
              strokeWidth={1.5}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-player-cue-cream/65 pointer-events-none"
              aria-hidden
            />
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={customAmount}
              onChange={(e) => handleCustomAmount(e.target.value.replace(/\D/g, ''))}
              placeholder="Other amount (100–10,000)"
              aria-label="Custom amount in rupees"
              aria-invalid={amountError !== null}
              aria-describedby={amountError ? 'ck-amt-err' : undefined}
              className="player-input w-full pl-10 pr-4 py-3.5 bg-player-felt-deep border border-player-ball-white/35 rounded text-player-ball-white text-[16px] font-mono min-h-[48px] focus:outline-none focus:border-player-cue-yellow focus:ring-[3px] focus:ring-player-cue-yellow/15 placeholder:text-player-cue-cream/40"
            />
          </div>
          {amountError && (
            <p id="ck-amt-err" className="font-body text-[12px] text-player-ball-red mt-1.5">{amountError}</p>
          )}
        </div>

        {/* Coin earning preview. Player browser doesn't know the owner-side
            welcome-bonus config; phrase as a lower bound. Exact total is
            surfaced server-side via coins_credited on confirmation. See #87
            / Pattern P1. */}
        {clubInfo?.coinsEnabled && amount > 0 && clubInfo.coinTiers.length > 0 && (() => {
          const coins = coinsEarnedForTopup(amount, clubInfo.coinTiers)
          if (coins <= 0) return null
          return (
            <div
              className="flex items-start gap-3 px-4 py-3 rounded"
              style={{ background: 'rgba(244, 197, 66, 0.1)', border: '1px solid rgba(244, 197, 66, 0.3)' }}
            >
              <Coins size={18} strokeWidth={1.5} className="text-player-cue-yellow shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="font-body text-[14px] font-medium text-player-cue-yellow">
                  Earn at least {coins.toLocaleString('en-IN')} ClubCoins
                </p>
                <p className="font-body text-[12px] text-player-cue-cream/65 mt-0.5">
                  + welcome bonus on your first top-up here
                </p>
              </div>
            </div>
          )
        })()}

        {/* Book a table — Phase 1, #84. Second CTA below the topup submit.
            Shown only when the club has opted in (`accepts_bookings=true` in
            Supabase) AND there's at least one mirrored table with an `id`
            (Part A defensive read — without ids we can't safely submit). */}
        {clubInfo?.acceptsBookings && clubInfo.tablesJson.some((t) => typeof t.id === 'number') && (
          <button
            type="button"
            onClick={() => clubSlug && navigate(`/c/${clubSlug}/book`)}
            className="w-full min-h-[48px] rounded font-body font-semibold text-[14px] bg-transparent border border-player-cue-yellow text-player-cue-yellow flex items-center justify-center gap-2 tracking-wide focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/30 active:scale-[0.98] transition-transform"
          >
            <Calendar size={16} strokeWidth={1.5} aria-hidden />
            <span>Book a table</span>
          </button>
        )}

        {/* Pricing visibility (Phase 0, #84). Hidden entirely when the club
            hasn't enabled the display OR has no public tables_json yet. */}
        {clubInfo?.acceptsPricingDisplay && clubInfo.tablesJson.length > 0 && (
          <PricingCard tables={clubInfo.tablesJson} />
        )}
      </div>

      {/* Sticky bottom CTA (design system §9). Lives outside the scrolling
          content above so it stays visible while the form scrolls on small
          phones. iOS safe-area inset honoured. */}
      <div
        className="fixed bottom-0 left-0 right-0 px-[18px] pt-3 pointer-events-none"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          background:
            'linear-gradient(to top, rgba(6, 36, 24, 0.95) 60%, rgba(6, 36, 24, 0))',
        }}
      >
        <div className="mx-auto w-full max-w-[480px] pointer-events-auto">
          <button
            onClick={handleSubmit}
            disabled={!formValid || submitting}
            className={`w-full min-h-[52px] rounded font-body font-semibold text-[15px] tracking-wide flex items-center justify-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-player-cue-yellow/50 focus:ring-offset-2 focus:ring-offset-player-felt ${
              formValid && !submitting
                ? 'bg-player-cue-yellow text-player-felt-deep active:scale-[0.98]'
                : 'bg-player-cue-yellow/40 text-player-felt-deep/60 cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <>
                <PlayerLoader size={10} label="Submitting" />
                <span>Submitting…</span>
              </>
            ) : (
              <span>Top up {amount ? formatRupees(amount) : '—'}</span>
            )}
          </button>
        </div>
      </div>
    </PlayerScanLayout>
  )
}
