import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, addDays } from 'date-fns'
import { useAuthStore } from '../store/authStore'
import { PlanSelection } from '../components/subscribe/PlanSelection'
import { StickyCheckout } from '../components/subscribe/StickyCheckout'
import { PaymentBottomSheet } from '../components/subscribe/PaymentBottomSheet'
import { ConfirmationScreen } from '../components/subscribe/ConfirmationScreen'

type PlanId = 'starter' | 'standard'
type Billing = 'monthly' | 'annual'
type Screen = 'plans' | 'confirmed'

const MONTHLY_PRICES: Record<PlanId, number> = { starter: 299, standard: 599 }
const ANNUAL_PRICES: Record<PlanId, number> = { starter: 2990, standard: 5990 }

function getPrice(plan: PlanId, billing: Billing): number {
  return billing === 'monthly' ? MONTHLY_PRICES[plan] : ANNUAL_PRICES[plan]
}

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

export default function Subscribe() {
  const navigate = useNavigate()
  const { session, subscription, loading: authLoading, profile, user } = useAuthStore()

  // Auth guard
  useEffect(() => {
    if (authLoading) return
    if (!session) { navigate('/signup', { replace: true }); return }
    const sub = subscription
    if (sub && (sub.status === 'trialing' || sub.status === 'active' || sub.status === 'past_due')) {
      navigate('/tables', { replace: true })
    }
  }, [authLoading, session, subscription, navigate])

  const [screen, setScreen] = useState<Screen>('plans')
  const [billing, setBilling] = useState<Billing>('monthly')
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('standard')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const [showBackWarning, setShowBackWarning] = useState(false)
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trialEndDate = format(addDays(new Date(), 7), 'MMM d')
  const currentPrice = getPrice(selectedPlan, billing)
  const firstName = profile?.displayName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there'
  const email = profile?.email ?? user?.email ?? ''
  const avatarInitial = (firstName[0] ?? 'U').toUpperCase()

  function handleBack() {
    setShowBackWarning(true)
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current)
    warnTimerRef.current = setTimeout(() => setShowBackWarning(false), 3500)
  }

  async function handlePayNow() {
    if (paying) return
    setPaying(true)
    await new Promise((r) => setTimeout(r, 1400)) // FAKE — real Razorpay in Prompt 13
    setPaying(false)
    setSheetOpen(false)
    setScreen('confirmed')
    // NOTE: no Supabase update here yet — Prompt 13 writes subscription.status = 'trialing'
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
          <PlanSelection
            billing={billing}
            onBillingChange={setBilling}
            selectedPlan={selectedPlan}
            onPlanSelect={setSelectedPlan}
            displayName={firstName}
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

        {/* Payment bottom sheet */}
        <PaymentBottomSheet
          open={sheetOpen}
          onClose={() => !paying && setSheetOpen(false)}
          selectedPlan={selectedPlan}
          billing={billing}
          currentPrice={currentPrice}
          trialEndDate={trialEndDate}
          paying={paying}
          onPay={handlePayNow}
        />
      </div>
    </div>
  )
}
