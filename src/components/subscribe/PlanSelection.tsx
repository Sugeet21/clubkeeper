import { BillingToggle } from './BillingToggle'
import { PlanCard } from './PlanCard'

type PlanId = 'starter' | 'standard'
type Billing = 'monthly' | 'annual'

interface Props {
  billing: Billing
  onBillingChange: (b: Billing) => void
  selectedPlan: PlanId
  onPlanSelect: (p: PlanId) => void
  displayName: string
}

const PLANS = [
  {
    id: 'starter' as const,
    name: 'Starter',
    monthlyPrice: 299,
    annualPrice: 2990,
    subtitle: 'Perfect for small clubs',
    features: [
      { text: 'Up to 3 tables', soon: false },
      { text: 'Live timer + pause/resume', soon: false },
      { text: 'Daily revenue summary', soon: false },
      { text: 'Works offline (no WiFi)', soon: false },
      { text: 'Setup support via WhatsApp', soon: false },
    ],
    featured: false,
    disabled: false,
    badge: null,
  },
  {
    id: 'standard' as const,
    name: 'Standard',
    monthlyPrice: 599,
    annualPrice: 5990,
    subtitle: 'For growing clubs',
    features: [
      { text: 'Up to 8 tables', soon: false },
      { text: 'Everything in Starter', soon: false },
      { text: 'Multi-day history & reports', soon: false },
      { text: 'Export to Excel / CSV', soon: false },
      { text: 'Time rounding (15 / 30 min)', soon: false },
      { text: 'Priority WhatsApp support', soon: false },
    ],
    featured: true,
    disabled: false,
    badge: 'Most popular',
  },
  {
    id: 'pro' as const,
    name: 'Pro',
    monthlyPrice: 999,
    annualPrice: 9990,
    subtitle: 'For large clubs & chains',
    features: [
      { text: 'Unlimited tables', soon: false },
      { text: 'Everything in Standard', soon: false },
      { text: 'Multi-staff login (coming soon)', soon: true },
      { text: 'WhatsApp bill sharing (coming soon)', soon: true },
      { text: 'Live owner dashboard (coming soon)', soon: true },
      { text: 'Multi-location support (coming soon)', soon: true },
    ],
    featured: false,
    disabled: true,
    badge: 'Coming soon',
  },
]

export function PlanSelection({ billing, onBillingChange, selectedPlan, onPlanSelect, displayName }: Props) {
  return (
    <div className="px-5 pt-5 pb-40">
      {/* Welcome */}
      <div className="mb-[18px]">
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em] leading-[1.15] text-text mb-1.5">
          Welcome, <span className="text-accent">{displayName}</span> 👋
        </h1>
        <p className="text-[14.5px] text-text-dim">
          Pick a plan to start your 7-day free trial. You won't be charged until day 8.
        </p>
      </div>

      {/* Billing toggle */}
      <BillingToggle billing={billing} onChange={onBillingChange} />

      {/* Plan cards */}
      <div className="flex flex-col gap-3.5">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            id={plan.id}
            name={plan.name}
            billing={billing}
            monthlyPrice={plan.monthlyPrice}
            annualPrice={plan.annualPrice}
            subtitle={plan.subtitle}
            features={plan.features}
            featured={plan.featured}
            disabled={plan.disabled}
            badge={plan.badge}
            selected={plan.id === selectedPlan}
            onSelect={() => {
              if (!plan.disabled && (plan.id === 'starter' || plan.id === 'standard')) {
                onPlanSelect(plan.id)
              }
            }}
          />
        ))}
      </div>

      {/* ROI reassurance */}
      <div
        className="mt-[18px] flex gap-3 items-start rounded-[14px] px-4 py-3.5"
        style={{ background: 'rgba(184,255,90,.04)' }}
      >
        <div className="w-9 h-9 flex-shrink-0 rounded-[10px] bg-[#0f1411] border border-border flex items-center justify-center text-[18px]">
          💰
        </div>
        <p className="text-[13px] text-text-dim leading-relaxed">
          At <span className="font-semibold text-text">₹599/month</span>, ClubKeeper pays for itself in{' '}
          <span className="font-semibold text-text">2 days</span> if you prevent just one forgotten timer per day.
        </p>
      </div>
    </div>
  )
}
