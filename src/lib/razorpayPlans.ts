export type Tier = 'starter' | 'standard' | 'pro'
export type Cycle = 'monthly' | 'annual'

export const RAZORPAY_PLANS: Record<`${Tier}_${Cycle}`, string> = {
  starter_monthly: 'plan_5shBXPM8XV0HwB',
  starter_annual: 'plan_5shDtaqKDM84Ie',
  standard_monthly: 'plan_5shF1qj5PW0A19',
  standard_annual: 'plan_5shFh5N1LH24eF',
  pro_monthly: 'plan_5sh3Rj6D3rEMe7',
  pro_annual: 'plan_SshJ4iqI7iICkz',
}

export function getPlanId(tier: Tier, cycle: Cycle): string {
  return RAZORPAY_PLANS[`${tier}_${cycle}`]
}
