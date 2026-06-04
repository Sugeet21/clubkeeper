// Pattern S5: Plan IDs are mode-isolated in Razorpay — TEST keys can only
// resolve TEST plan IDs, LIVE keys can only resolve LIVE plan IDs.
// BUG-021: mode-mismatch (TEST key + LIVE plan IDs) yields 400 "ID not found".
// Permanent fix: auto-select TEST_PLANS or LIVE_PLANS based on key prefix.
// Switching Vercel env between TEST ↔ LIVE now requires zero code changes.

export type Tier = 'starter' | 'standard' | 'pro' | 'test'
export type Cycle = 'monthly' | 'annual'

// 'test' tier is LIVE-only (plan_Sx0LfhJGzccBHQ, ₹10/month).
// Gated to Sugeet email in Subscribe.tsx. Never resolves in TEST mode.
type PlanMapKey = `${Tier}_${Cycle}`
type PlanMap = Partial<Record<PlanMapKey, string>>

const TEST_PLANS: PlanMap = {
  starter_monthly:  'plan_StMW5oAsLAtnhZ',
  starter_annual:   'plan_StMWqCgfGa9qQr',
  standard_monthly: 'plan_StMXCxGDPtszfl',
  standard_annual:  'plan_StMXaqlYWXAqe3',
  pro_monthly:      'plan_StMXyF3jrkSbwA',
  pro_annual:       'plan_StMeJcHJqAkqAY',
  // 'test' tier intentionally omitted — LIVE key required
}

const LIVE_PLANS: PlanMap = {
  starter_monthly:  'plan_SshBkPM8XVcHxB',
  starter_annual:   'plan_SshDtagKUM84Ie',
  standard_monthly: 'plan_SshF14jP8WCA19',
  standard_annual:  'plan_SshFh5NILH24ef',
  pro_monthly:      'plan_SshGRj6D3rfWzJ',
  pro_annual:       'plan_SshJ4iqI7iICkz',
  test_monthly:     'plan_Sx0LfhJGzccBHQ',
  // test_annual intentionally omitted — ₹10 plan is monthly only
}

const keyId: string | undefined = import.meta.env.VITE_RAZORPAY_KEY_ID

if (keyId === undefined || keyId === '') {
  console.warn(
    '[razorpayPlans] VITE_RAZORPAY_KEY_ID is not set. ' +
    'Plan auto-selection will default to TEST_PLANS. ' +
    'Set the env var to rzp_test_... or rzp_live_...'
  )
} else if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
  console.warn(
    `[razorpayPlans] VITE_RAZORPAY_KEY_ID has unexpected prefix: "${keyId.slice(0, 12)}...". ` +
    'Expected rzp_test_ or rzp_live_. Defaulting to TEST_PLANS.'
  )
}

export const isLiveMode: boolean = keyId?.startsWith('rzp_live_') === true

// Single source of truth — consumed by api/create-subscription.ts and frontend
export const PLANS: PlanMap = isLiveMode ? LIVE_PLANS : TEST_PLANS

export function getPlanId(tier: Tier, cycle: Cycle): string {
  const id = PLANS[`${tier}_${cycle}`]
  if (!id) throw new Error(`[razorpayPlans] No plan ID for tier="${tier}" cycle="${cycle}" in current mode (isLiveMode=${isLiveMode})`)
  return id
}
