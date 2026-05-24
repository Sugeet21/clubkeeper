// Pattern S5 — server-side mirror of src/lib/razorpayPlans.ts
// Cannot use import.meta.env here (Node runtime). Reads process.env directly.
// Auto-selects TEST_PLANS or LIVE_PLANS based on key prefix.
// See BUG-021 and Pattern S5 in bug_patterns.md for the full story.

export type Tier = 'starter' | 'standard' | 'pro'
export type Cycle = 'monthly' | 'annual'

type PlanMap = Record<`${Tier}_${Cycle}`, string>

const TEST_PLANS: PlanMap = {
  starter_monthly:  'plan_StMW5oAsLAtnhZ',
  starter_annual:   'plan_StMWqCgfGa9qQr',
  standard_monthly: 'plan_StMXCxGDPtszfl',
  standard_annual:  'plan_StMXaqlYWXAqe3',
  pro_monthly:      'plan_StMXyF3jrkSbwA',
  pro_annual:       'plan_StMeJcHJqAkqAY',
}

const LIVE_PLANS: PlanMap = {
  starter_monthly:  'plan_SshBkPM8XVcHxB',
  starter_annual:   'plan_SshDtagKUM84Ie',
  standard_monthly: 'plan_SshF14jP8WCA19',
  standard_annual:  'plan_SshFh5NILH24ef',
  pro_monthly:      'plan_SshGRj6D3rfWzJ',
  pro_annual:       'plan_SshJ4iqI7iICkz',
}

// Vercel exposes VITE_RAZORPAY_KEY_ID (the same variable name) in serverless
// functions — confirmed by api/create-subscription.ts using process.env.VITE_RAZORPAY_KEY_ID.
const keyId: string | undefined = process.env.VITE_RAZORPAY_KEY_ID

if (!keyId) {
  console.warn(
    '[plans/_shared] VITE_RAZORPAY_KEY_ID is not set in server env. ' +
    'Defaulting to TEST_PLANS.'
  )
} else if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) {
  console.warn(
    `[plans/_shared] VITE_RAZORPAY_KEY_ID has unexpected prefix: "${keyId.slice(0, 12)}...". ` +
    'Expected rzp_test_ or rzp_live_. Defaulting to TEST_PLANS.'
  )
}

const isTestMode: boolean = keyId?.startsWith('rzp_live_') !== true

export const PLANS: PlanMap = isTestMode ? TEST_PLANS : LIVE_PLANS

export function getPlanId(tier: Tier, cycle: Cycle): string {
  return PLANS[`${tier}_${cycle}`]
}
