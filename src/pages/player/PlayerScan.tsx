import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import PlayerScanLayout from './PlayerScanLayout'
import { UpiQrCard } from '../../components/UpiQrCard'
import { getClubPublicInfo, submitTopupIntent, getTopupIntentStatus } from '../../lib/playerHubApi'
import type { ClubPublicInfo, PublicTableInfo } from '../../types/playerHub'
import { coinsEarnedForTopup } from '../../lib/coins'

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

  // Group by gameType, preserving insertion order
  const groups = new Map<string, PublicTableInfo[]>()
  for (const t of tables) {
    const arr = groups.get(t.gameType) ?? []
    arr.push(t)
    groups.set(t.gameType, arr)
  }

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px] text-left"
      >
        <span className="text-[14px]">💰</span>
        <span className="flex-1 text-[14px] font-semibold text-text">View pricing</span>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          className={`text-text-faint shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border space-y-4">
          {Array.from(groups.entries()).map(([gameType, list]) => (
            <div key={gameType}>
              <p className="text-[11px] font-mono uppercase tracking-widest text-text-faint mb-2">
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
    <div className="bg-bg border border-border rounded-xl px-3 py-2.5">
      <p className="text-[14px] font-semibold text-text">{table.name}</p>
      {hasCard ? (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
            {table.rateCard!.map((tier, i) => (
              <span key={i} className="text-[13px] text-text-dim font-mono">
                {tier.minutes} min {formatRupees(tier.price)}
                {i < table.rateCard!.length - 1 && (
                  <span className="text-text-faint ml-3">·</span>
                )}
              </span>
            ))}
          </div>
          {table.toleranceMinutes !== undefined && table.toleranceMinutes > 0 && (
            <p className="text-[11px] text-text-faint mt-1.5">
              {table.toleranceMinutes} min grace at every tier
            </p>
          )}
        </>
      ) : (
        <p className="text-[13px] text-text-dim font-mono mt-1">
          {formatRupees(table.ratePerHour)}/hr
          {table.ratePerFrame !== undefined && (
            <span className="ml-2 text-text-faint">
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

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="border-2 border-accent border-t-transparent rounded-full animate-spin"
      style={{ width: size, height: size }}
    />
  )
}

export default function PlayerScan() {
  const { clubSlug } = useParams<{ clubSlug: string }>()
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
          <div className="w-12 h-12 rounded-full bg-busy/12 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-busy">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className="text-text font-semibold">{error ?? 'Something went wrong'}</p>
          <p className="text-text-dim text-sm">Please check your internet connection and try again.</p>
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

  if (pageState === 'topups_disabled') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <p className="text-text-dim text-[15px]">Top-ups are currently disabled at this club.</p>
          <p className="text-text-faint text-sm">Please ask the staff for assistance.</p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'confirmed') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-6 py-10 text-center">
          <div className="w-16 h-16 rounded-full bg-free/12 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-free">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="text-[22px] font-bold text-text">
              ₹{amount.toLocaleString('en-IN')} added to your wallet
            </p>
            <p className="text-text-dim text-sm mt-2">
              at {clubInfo?.clubName ?? 'the club'}
            </p>
          </div>
          <div className="bg-bg-card border border-border rounded-2xl px-5 py-3 w-full">
            <p className="text-text-faint text-[12px]">Show your mobile at the table to use your balance</p>
            <p className="text-text font-mono font-bold text-lg mt-1">{mobile.replace(/(\d{5})(\d{5})/, '$1 $2')}</p>
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
              <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl w-full">
                <span className="text-amber-400 font-semibold text-[14px]">
                  🪙 +{coins.toLocaleString('en-IN')} ClubCoins credited!
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
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-busy/12 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-busy">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <p className="text-[18px] font-bold text-text">Top-up rejected</p>
          {rejectReason && <p className="text-text-dim text-sm">{rejectReason}</p>}
          <p className="text-text-faint text-sm">Please speak to staff.</p>
        </div>
      </PlayerScanLayout>
    )
  }

  if (pageState === 'expired') {
    return (
      <PlayerScanLayout>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-[18px] font-bold text-text">Request expired</p>
          <p className="text-text-dim text-sm">This request expired after 10 minutes.</p>
          <button
            onClick={() => { stopPolling(); setIntentId(null); setPageState('form') }}
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
            <p className="text-[17px] font-bold text-text">
              Waiting for staff to confirm your ₹{amount.toLocaleString('en-IN')}…
            </p>
            <p className="text-text-dim text-sm mt-2">
              This usually takes under a minute.
            </p>
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
      ? `upi://pay?pa=${encodeURIComponent(clubInfo.upiId)}&pn=${encodeURIComponent(clubInfo.clubName)}&am=${amount}&tn=${encodeURIComponent(upiNote)}&cu=INR`
      : null

    return (
      <PlayerScanLayout>
        <div className="flex flex-col gap-5">
          {/* Step 1 done */}
          <div className="bg-free/8 border border-free/30 rounded-2xl px-4 py-3 flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-free shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-free font-semibold text-[14px]">Step 1 of 2 complete</p>
          </div>

          {/* Payment block */}
          <div className="bg-bg-card border border-border rounded-2xl p-4 flex flex-col items-center gap-4">
            <p className="text-[26px] font-bold font-mono text-text">
              ₹{amount.toLocaleString('en-IN')}
            </p>

            {upiDeepLink ? (
              <>
                {/* Primary: UPI deep-link button */}
                <a
                  href={upiDeepLink}
                  className="block w-full bg-green-500 text-black font-bold text-[17px] py-4 rounded-2xl text-center"
                >
                  Pay ₹{amount.toLocaleString('en-IN')} with UPI
                </a>
                <p className="text-[12px] text-text-faint text-center -mt-2">
                  Opens GPay, PhonePe, Paytm, or any UPI app
                </p>

                {/* Secondary: collapsible QR for another device */}
                <details className="w-full">
                  <summary className="text-[13px] text-text-faint cursor-pointer text-center">
                    Or scan from another device
                  </summary>
                  <div className="mt-3 flex justify-center">
                    <UpiQrCard
                      amount={amount}
                      upiId={clubInfo!.upiId!}
                      payeeName={clubInfo!.clubName}
                      transactionNote={upiNote}
                    />
                  </div>
                </details>
              </>
            ) : (
              <div className="bg-paused/8 border border-paused/30 rounded-2xl px-5 py-4 w-full text-center">
                <p className="text-paused font-semibold">Pay ₹{amount.toLocaleString('en-IN')} cash to staff</p>
              </div>
            )}

            <div className="w-full bg-bg border border-border rounded-2xl px-4 py-2 text-center">
              <p className="text-text-faint text-[11px] font-mono uppercase tracking-widest">Reference code</p>
              <p className="text-accent font-mono font-bold text-lg tracking-widest">{shortCode}</p>
            </div>
          </div>

          {/* I've paid button */}
          <button
            onClick={() => setPageState('waiting_confirm')}
            disabled={!payBtnEnabled}
            className={`w-full min-h-[52px] rounded-2xl font-bold text-[16px] transition-opacity ${
              payBtnEnabled
                ? 'bg-accent text-bg'
                : 'bg-accent/40 text-bg/60 cursor-not-allowed'
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

  // ─── Form state ────────────────────────────────────────────────────────────

  return (
    <PlayerScanLayout>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div>
          <p className="text-text-faint text-[12px] font-mono uppercase tracking-widest mb-1">
            {clubInfo?.clubName ?? 'Club'}
          </p>
          <h1 className="text-[24px] font-bold text-text">Add wallet balance</h1>
          <p className="text-text-dim text-sm mt-1">
            Pay via UPI, then staff will credit your wallet.
          </p>
        </div>

        {/* Name (optional) */}
        <div>
          <label className="block text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
            Your name (optional)
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(null) }}
            placeholder="Rahul"
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          {nameError && <p className="text-busy text-[13px] mt-1.5">{nameError}</p>}
        </div>

        {/* Mobile (required) */}
        <div>
          <label className="block text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
            Mobile number <span className="text-busy">*</span>
          </label>
          <input
            type="tel"
            inputMode="numeric"
            value={mobile}
            onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '').slice(0, 10)); setMobileError(null) }}
            placeholder="9876543210"
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint font-mono"
          />
          {mobileError && <p className="text-busy text-[13px] mt-1.5">{mobileError}</p>}
        </div>

        {/* Amount */}
        <div>
          <label className="block text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
            Amount <span className="text-busy">*</span>
          </label>
          <div className="flex gap-2 flex-wrap mb-3">
            {AMOUNT_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => handleAmountChip(chip)}
                className={`min-h-[44px] px-4 rounded-full text-[14px] font-semibold border transition-colors ${
                  amount === chip && !customAmount
                    ? 'bg-accent text-bg border-accent'
                    : 'bg-bg-card text-text border-border'
                }`}
              >
                ₹{chip}
              </button>
            ))}
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={customAmount}
            onChange={(e) => handleCustomAmount(e.target.value.replace(/\D/g, ''))}
            placeholder="Other amount (₹100–₹10,000)"
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          {amountError && <p className="text-busy text-[13px] mt-1.5">{amountError}</p>}
        </div>

        {/* Coin earning preview. The player browser doesn't know the
            owner-side welcome-bonus config, so we phrase the lower bound
            ('at least N') and hint at the first-top-up bonus. The exact
            total is surfaced server-side on the confirmation screen via
            coins_credited. See #87 / Pattern P1. */}
        {clubInfo?.coinsEnabled && amount > 0 && clubInfo.coinTiers.length > 0 && (() => {
          const coins = coinsEarnedForTopup(amount, clubInfo.coinTiers)
          if (coins <= 0) return null
          return (
            <div className="flex flex-col gap-0.5 px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <span className="text-[14px] text-amber-400 font-semibold">
                🪙 You'll earn at least {coins.toLocaleString('en-IN')} ClubCoins on this top-up
              </span>
              <span className="text-[11px] text-amber-300/80">
                + welcome bonus if this is your first top-up here
              </span>
            </div>
          )
        })()}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!isFormValid() || pageState === 'submitting'}
          className={`w-full min-h-[52px] rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 transition-opacity ${
            isFormValid() && pageState !== 'submitting'
              ? 'bg-accent text-bg'
              : 'bg-accent/40 text-bg/60 cursor-not-allowed'
          }`}
        >
          {pageState === 'submitting' ? (
            <>
              <Spinner size={18} />
              <span>Submitting…</span>
            </>
          ) : (
            `Pay ₹${amount ? amount.toLocaleString('en-IN') : '—'} via UPI`
          )}
        </button>

        {/* Pricing visibility (Phase 0, #84). Hidden entirely when the club
            hasn't enabled the display OR has no public tables_json yet. */}
        {clubInfo?.acceptsPricingDisplay && clubInfo.tablesJson.length > 0 && (
          <PricingCard tables={clubInfo.tablesJson} />
        )}
      </div>
    </PlayerScanLayout>
  )
}
