import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { PlanSelection } from '../components/subscribe/PlanSelection'
import { StickyCheckout } from '../components/subscribe/StickyCheckout'
import { PaymentBottomSheet } from '../components/subscribe/PaymentBottomSheet'
import { ConfirmationScreen } from '../components/subscribe/ConfirmationScreen'

type PlanId = 'starter' | 'standard' | 'pro' | 'test'
type Billing = 'monthly' | 'annual'
type Screen = 'plans' | 'confirmed'

const MONTHLY_PRICES: Record<PlanId, number> = { starter: 299, standard: 599, pro: 999, test: 10 }
const ANNUAL_PRICES: Record<PlanId, number> = { starter: 2990, standard: 5990, pro: 9990, test: 120 }

function getPrice(plan: PlanId, billing: Billing): number {
  return billing === 'monthly' ? MONTHLY_PRICES[plan] : ANNUAL_PRICES[plan]
}

const FETCH_TIMEOUT_MS = 15_000

function ProgressStep({ status, label }: { status: 'done' | 'now' | 'upcoming'; label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 font-mono text-[11px] tracking-[.08em] uppercase font-medium px-2.5 py-1.5 rounded-full border"
      style={
        status === 'done'
          ? { color: '#b8ff5a', borderColor: 'rgba(184,255,90,.25)', background: 'rgba(184,255,90,.06)' }
          : status === 'now'
          ? { color: '#e8efe9', borderColor: 'rgba(184,255,90,.35)', background: 'rgba(184,255,90,.12)' }
          : { color: '#555f57', borderColor: '#2a322d', background: '#0f1411' }
      }
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'now' ? 'animate-pulse' : ''}`}
        style={{
          background:
            status === 'done' ? '#b8ff5a' : status === 'now' ? '#b8ff5a' : 'rgba(85,95,87,.4)',
        }}
      />
      {label}
    </span>
  )
}

type LocationState = { reason?: 'trial_expired' | 'subscribe_early' } | null
type HeadlineState = { kind: 'expired' } | { kind: 'early'; daysLeft: number } | { kind: 'welcome' }

export default function Subscribe() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationReason = (location.state as LocationState)?.reason
  const { session, subscription, loading: authLoading, profile, user } = useAuthStore()

  // Auth guard — redirect already-active/past_due users to /tables.
  // Trial-expired users (reason='trial_expired') and subscribe-early users
  // (reason='subscribe_early') both land here intentionally — do NOT bounce them.
  useEffect(() => {
    if (authLoading) return
    if (!session) { navigate('/signup', { replace: true }); return }
    const sub = subscription
    if (sub && sub.status === 'active') { navigate('/tables', { replace: true }); return }
    if (sub && sub.status === 'past_due') { navigate('/tables', { replace: true }); return }
    // Trialing: only bounce back if the trial is active AND user did NOT choose to come here.
    // subscribe_early reason = user intentionally tapped Manage → stay on page.
    // trial_expired reason = forced redirect → stay on page.
    if (sub && sub.status === 'trialing' && !locationReason) {
      const trialActive = sub.trialEndsAt ? sub.trialEndsAt > Date.now() : false
      if (trialActive) navigate('/tables', { replace: true })
    }
  }, [authLoading, session, subscription, navigate, locationReason])

  const headline = useMemo((): HeadlineState => {
    const sub = subscription
    const now = Date.now()
    // Explicit state signal takes priority over live subscription state
    if (locationReason === 'trial_expired') return { kind: 'expired' }
    if (locationReason === 'subscribe_early') {
      const daysLeft = sub?.trialEndsAt
        ? Math.max(0, Math.ceil((sub.trialEndsAt - now) / 86_400_000))
        : 0
      return { kind: 'early', daysLeft }
    }
    // Fallback: derive from live subscription status (handles browser-refresh edge case)
    if (sub?.status === 'trialing' && sub.trialEndsAt) {
      if (sub.trialEndsAt <= now) return { kind: 'expired' }
      const daysLeft = Math.max(0, Math.ceil((sub.trialEndsAt - now) / 86_400_000))
      return { kind: 'early', daysLeft }
    }
    return { kind: 'welcome' }
  }, [locationReason, subscription])

  const [screen, setScreen] = useState<Screen>('plans')
  const [billing, setBilling] = useState<Billing>('monthly')
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>('standard')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  const [showBackWarning, setShowBackWarning] = useState(false)
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trialEndDate = format(addDays(new Date(), 7), 'MMM d')
  const currentPrice = selectedPlan ? getPrice(selectedPlan, billing) : 0

  // V1-LAUNCH: only Standard Monthly shown to all users.
  // live_10 test plan ('test' tier) is additionally shown only to Sugeet in LIVE mode.
  const BASE_VISIBLE_PLAN_IDS: readonly PlanId[] = ['standard']
  const SUGEET_TEST_EMAILS = ['sugeetjadhav@gmail.com']
  const isLiveMode = import.meta.env.VITE_RAZORPAY_KEY_ID?.startsWith('rzp_live_') === true
  const showLiveTestPlan = isLiveMode && !!user?.email && SUGEET_TEST_EMAILS.includes(user.email)
  const visiblePlanIds: readonly PlanId[] = showLiveTestPlan
    ? [...BASE_VISIBLE_PLAN_IDS, 'test']
    : BASE_VISIBLE_PLAN_IDS

  const firstName = profile?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'
  const email = profile?.email ?? user?.email ?? ''
  const avatarInitial = (firstName[0] ?? 'U').toUpperCase()

  function handleBack() {
    setShowBackWarning(true)
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
    warnTimerRef.current = setTimeout(() => setShowBackWarning(false), 3500)
  }

  function handleMaybeLater() {
    setSheetOpen(false)
    setSelectedPlan(null)
    setPayError(null)
  }

  // Lock body scroll when sheet is open
  useEffect(() => {
    document.body.style.overflow = sheetOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sheetOpen])

  async function handlePayNow() {
    if (paying || !selectedPlan) return
    setPaying(true)
    setPayError(null)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      if (!authSession) throw new Error('Not authenticated')

      let res: Response
      try {
        res = await fetch('/api/create-subscription', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authSession.access_token}`,
          },
          body: JSON.stringify({
            userId: authSession.user.id,
            tier: selectedPlan,
            cycle: billing,
          }),
          signal: controller.signal,
        })
      } catch (fetchErr) {
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          throw new Error('Request timed out after 15 seconds. Please check your connection and try again.')
        }
        throw fetchErr
      } finally {
        clearTimeout(timeoutId)
      }

      if (res.status === 404) {
        throw new Error(
          "Backend payment service is unavailable. If you're testing locally, run `vercel dev` instead of `npm run dev`. If you're on production, contact support."
        )
      }

      if (!res.ok) {
        let errMsg = 'Payment failed. Please try again or contact support.'
        try {
          const errBody = await res.json() as { error?: string }
          if (errBody.error) errMsg = errBody.error
        } catch {
          // JSON parse failed — use generic message
        }
        throw new Error(errMsg)
      }

      let subscriptionId: string
      try {
        const body = await res.json() as { subscriptionId: string }
        subscriptionId = body.subscriptionId
      } catch {
        throw new Error('Unexpected response from server. Please try again or contact support.')
      }

      const rzp = new window.Razorpay({
        key: import.meta.env.VITE_RAZORPAY_KEY_ID as string,
        subscription_id: subscriptionId,
        name: 'ClubKeeper',
        description: `${selectedPlan} plan — 7-day free trial`,
        prefill: {
          name: profile?.displayName ?? '',
          email: profile?.email ?? session?.user.email ?? '',
        },
        theme: { color: '#b8ff5a' },
        handler: async () => {
          // Webhook updates Supabase authoritatively; brief delay gives it a head start
          await new Promise((r) => setTimeout(r, 1500))
          await useAuthStore.getState().refreshProfile(true)
          setSheetOpen(false)
          setScreen('confirmed')
          setPaying(false)
        },
        modal: {
          ondismiss: () => {
            setPaying(false)
          },
        },
      })
      rzp.open()
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('handlePayNow error:', err)
      setPayError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setPaying(false)
    }
  }

  function handleRetryPayment() {
    setPayError(null)
    void handlePayNow()
  }

  if (screen === 'confirmed') {
    return (
      <ConfirmationScreen
        email={email}
        trialEndDate={trialEndDate}
        onContinue={() => navigate('/tables', { replace: true })}
      />
    )
  }

  return (
    <div
      className="min-h-screen flex justify-center"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -200px, rgba(184,255,90,.05), transparent 60%), #05080a',
      }}
    >
      <div
        className="w-full max-w-[390px] bg-bg relative flex flex-col overflow-hidden"
        style={{ minHeight: '100vh' }}
      >
        {/* Corner glows */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background:
              'radial-gradient(380px 280px at 90% -20px, rgba(184,255,90,.10), transparent 60%), radial-gradient(600px 400px at -20% 0%, rgba(184,255,90,.04), transparent 60%)',
          }}
        />

        {/* Top bar */}
        <header
          className="relative z-[6] h-[60px] grid items-center px-3 border-b flex-shrink-0"
          style={{
            gridTemplateColumns: '44px 1fr 44px',
            background: 'rgba(10,14,12,.78)',
            backdropFilter: 'saturate(140%) blur(10px)',
            WebkitBackdropFilter: 'saturate(140%) blur(10px)',
            borderColor: 'rgba(42,50,45,.6)',
          }}
        >
          <button
            onClick={handleBack}
            aria-label="Back"
            className="w-11 h-11 rounded-[12px] flex items-center justify-center text-text-dim border border-transparent transition-all duration-200 active:bg-bg-card active:border-border active:text-text"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="font-extrabold text-[16px] tracking-tight text-center text-text">
            Club<span className="text-accent">Keeper</span>
          </div>
          <div
            className="w-9 h-9 rounded-full bg-accent text-bg flex items-center justify-center font-extrabold text-[15px] tracking-[-0.02em] mx-auto"
            title={firstName}
          >
            {avatarInitial}
          </div>
        </header>

        {/* Back warning banner */}
        {showBackWarning && (
          <div
            className="absolute left-3 right-3 z-[8] top-[68px] flex items-start gap-2.5 px-3 py-2.5 rounded-[12px] text-[12.5px] leading-[1.4] backdrop-blur-sm"
            style={{
              background: 'rgba(247,201,72,.08)',
              border: '1px solid rgba(247,201,72,.3)',
            }}
          >
            <span className="w-[18px] h-[18px] flex-shrink-0 rounded-full bg-paused text-bg flex items-center justify-center font-bold text-[11px] mt-[1px]">
              !
            </span>
            <span className="text-text">
              <span className="font-bold">Account created.</span> Pick a plan to start using ClubKeeper.
            </span>
          </div>
        )}

        {/* Progress steps */}
        <div
          className="relative z-[3] flex items-center justify-center gap-2 px-4 py-3.5 border-b flex-shrink-0"
          style={{ borderColor: 'rgba(42,50,45,.4)' }}
        >
          <ProgressStep status="done" label="Sign up" />
          <span className="w-3.5 h-px bg-border" />
          <ProgressStep status="now" label="Choose plan" />
          <span className="w-3.5 h-px bg-border" />
          <ProgressStep status="upcoming" label="Pay" />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto relative z-[1]">
          {headline.kind === 'expired' && (
            <div className="px-5 pt-6 pb-2">
              <h2 className="text-[20px] font-extrabold tracking-tight text-text leading-[1.2]">
                Your free trial has ended
              </h2>
              <p className="mt-1.5 text-[14px] text-text-dim leading-[1.5]">
                Subscribe to keep using ClubKeeper for your club.
              </p>
            </div>
          )}
          {headline.kind === 'early' && (
            <div className="px-5 pt-6 pb-2">
              <h2 className="text-[20px] font-extrabold tracking-tight text-text leading-[1.2]">
                Subscribe early to lock in ₹599/month
              </h2>
              <p className="mt-1.5 text-[14px] text-text-dim leading-[1.5]">
                <span className="text-text font-semibold">{headline.daysLeft} {headline.daysLeft === 1 ? 'day' : 'days'}</span> left in your trial.{' '}
                {subscription?.trialEndsAt
                  ? <>Your plan starts on <span className="text-text font-semibold">{format(new Date(subscription.trialEndsAt), 'd MMM')}</span> — no overlap, no double charge.</>
                  : <>Your plan starts when the trial ends — no overlap, no double charge.</>
                }
              </p>
            </div>
          )}
          {headline.kind === 'welcome' && (
            <div className="px-5 pt-6 pb-2">
              <h1 className="text-[24px] font-extrabold tracking-[-0.03em] leading-[1.15] text-text mb-1.5">
                Welcome, <span className="text-accent">{firstName}</span> 👋
              </h1>
              <p className="text-[14.5px] text-text-dim">
                Start your 7-day free trial. You won't be charged until day 8.
              </p>
            </div>
          )}
          <PlanSelection
            billing={billing}
            onBillingChange={setBilling}
            selectedPlan={selectedPlan}
            onPlanSelect={setSelectedPlan}
            displayName={firstName}
            hideWelcome={true}
            visiblePlanIds={visiblePlanIds}
          />
        </div>

        {/* Sticky checkout bar */}
        <StickyCheckout
          selectedPlan={selectedPlan}
          billing={billing}
          currentPrice={currentPrice}
          trialEndDate={trialEndDate}
          onCheckout={() => setSheetOpen(true)}
        />

        {/* Modal overlay */}
        <div
          className="absolute inset-0 z-[20] transition-opacity duration-200"
          style={{
            background: 'rgba(0,0,0,.55)',
            backdropFilter: 'blur(2px)',
            opacity: sheetOpen ? 1 : 0,
            pointerEvents: sheetOpen ? 'auto' : 'none',
          }}
          onClick={() => !paying && setSheetOpen(false)}
        />

        {/* Payment bottom sheet — only render when plan is selected */}
        {selectedPlan && (
          <PaymentBottomSheet
            open={sheetOpen}
            onClose={() => !paying && setSheetOpen(false)}
            onMaybeLater={handleMaybeLater}
            selectedPlan={selectedPlan}
            billing={billing}
            currentPrice={currentPrice}
            trialEndDate={trialEndDate}
            paying={paying}
            payError={payError}
            onPay={handlePayNow}
            onRetry={handleRetryPayment}
          />
        )}
      </div>
    </div>
  )
}
