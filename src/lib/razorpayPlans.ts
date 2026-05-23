export type Tier = 'starter' | 'standard' | 'pro'
export type Cycle = 'monthly' | 'annual'
export const RAZORPAY_PLANS: Record<`${Tier}_${Cycle}`, string> = {
  starter_monthly: 'plan_SshBkPM8XVcHxB',
  starter_annual: 'plan_SshDtagKUM84Ie',
  standard_monthly: 'plan_SshF14jP8WCA19',
  standard_annual: 'plan_SshFh5NILH24ef',
  pro_monthly: 'plan_SshGRj6D3rfWzJ',
  pro_annual: 'plan_SshJ4iqI7iICkz',
}
export function getPlanId(tier: Tier, cycle: Cycle): string {
  return RAZORPAY_PLANS[`${tier}_${cycle}`]
}