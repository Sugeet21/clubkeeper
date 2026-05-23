import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'
import { getPlanId } from '../src/lib/razorpayPlans.js'
import type { Tier, Cycle } from '../src/lib/razorpayPlans.js'

const razorpay = new Razorpay({
  key_id: process.env.VITE_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_TIERS = new Set<Tier>(['starter', 'standard', 'pro'])
const VALID_CYCLES = new Set<Cycle>(['monthly', 'annual'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Authenticate caller via Supabase JWT
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' })
  }
  const token = authHeader.slice(7)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid auth token' })
  }

  const { tier, cycle } = req.body as { userId?: string; tier?: string; cycle?: string }

  if (!tier || !cycle) {
    return res.status(400).json({ error: 'Missing tier or cycle' })
  }
  if (!VALID_TIERS.has(tier as Tier) || !VALID_CYCLES.has(cycle as Cycle)) {
    return res.status(400).json({ error: 'Invalid tier or cycle' })
  }

  const planId = getPlanId(tier as Tier, cycle as Cycle)
  const nowSec = Math.floor(Date.now() / 1000)
  const trialEndSec = nowSec + 7 * 24 * 60 * 60
  const totalCount = cycle === 'monthly' ? 12 : 1

  type RazorpaySubscription = Awaited<ReturnType<typeof razorpay.subscriptions.create>>
  let subscription: RazorpaySubscription
  try {
    subscription = await razorpay.subscriptions.create({
      plan_id: planId,
      total_count: totalCount,
      customer_notify: 1,
      start_at: trialEndSec,
      notes: {
        userId: user.id,
        tier,
        cycle,
      },
    })
  } catch (err) {
    console.error('Razorpay subscription create error:', err)
    return res.status(500).json({ error: 'Failed to create subscription with payment provider' })
  }

  // Write to Supabase with service role (bypasses RLS)
  const trialEndsAt = new Date(trialEndSec * 1000).toISOString()
  const { error: dbError } = await supabase
    .from('subscriptions')
    .update({
      razorpay_subscription_id: subscription.id,
      status: 'trialing',
      plan: tier,
      trial_ends_at: trialEndsAt,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  if (dbError) {
    console.error('Supabase update error:', dbError)
    return res.status(500).json({ error: 'Failed to save subscription record' })
  }

  return res.status(200).json({
    subscriptionId: subscription.id,
    shortUrl: subscription.short_url,
  })
}
