// Request:  { userId?: string, tier: Tier, cycle: Cycle }
// Success:  { subscriptionId: string, shortUrl: string, startAt: number, scenario: 'new' | 'mid_trial' | 'expired' }
// Error:    { message: string, code?: string, razorpayStatus?: number }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'
// Uses api/_shared/plans.ts (not src/lib/razorpayPlans.ts) because the server
// runtime uses process.env, not import.meta.env. Both files share the same
// TEST_PLANS / LIVE_PLANS objects and auto-select by key prefix. See Pattern S5.
import { getPlanId } from './_shared/plans.js'
import type { Tier, Cycle } from './_shared/plans.js'

const razorpay = new Razorpay({
  key_id: process.env.VITE_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const VALID_TIERS = new Set<Tier>(['starter', 'standard', 'pro', 'test'])
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

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid auth token' })
  }

  const userId = user.id

  const { tier, cycle } = req.body as { userId?: string; tier?: string; cycle?: string }

  if (!tier || !cycle) {
    return res.status(400).json({ error: 'Missing tier or cycle' })
  }
  if (!VALID_TIERS.has(tier as Tier) || !VALID_CYCLES.has(cycle as Cycle)) {
    return res.status(400).json({ error: 'Invalid tier or cycle' })
  }

  let planId: string
  try {
    planId = getPlanId(tier as Tier, cycle as Cycle)
  } catch (e) {
    // getPlanId throws when plan is LIVE-only but server is in TEST mode
    const msg = e instanceof Error ? e.message : 'Plan not available in current mode'
    console.error('[create-subscription] getPlanId error:', msg)
    return res.status(400).json({ message: msg })
  }

  const totalCount = cycle === 'monthly' ? 12 : 1

  // ── BUG-026 fix: 3-scenario start_at logic ──────────────────────────────────
  // Read existing subscription row BEFORE creating the Razorpay subscription.
  // Server is the source of truth — frontend never sends timestamps or scenario flags.
  const nowMs = Date.now()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const minBufferSec = 60 // Razorpay rejects start_at < ~30s from now; use 60s for safety

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('subscriptions')
    .select('trial_ends_at, status')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileErr) {
    console.error('[create-subscription] supabase read error:', profileErr)
    return res.status(500).json({ message: 'Could not read subscription state.' })
  }

  const existingTrialEndsMs = profile?.trial_ends_at
    ? new Date(profile.trial_ends_at as string).getTime()
    : null

  type Scenario = 'new' | 'mid_trial' | 'expired' | 'test_5min_override'
  let scenario: Scenario
  let startAtSec: number
  let trialEndsAtToWrite: string | null // null = do not overwrite existing DB value

  // ═══════════════════════════════════════════════════════════════
  // 🚧 TEMPORARY — REMOVE AFTER LIVE PAYMENT TESTING 🚧
  // Compresses 7-day trial to 5 minutes for the test tier ONLY.
  // Lets Sugeet validate the first-charge webhook flow without
  // waiting a week. Production tiers are NOT affected.
  // Revert by deleting this entire if block (keep the else contents).
  // ═══════════════════════════════════════════════════════════════
  if (tier === 'test') {
    const fiveMinutesFromNowSec = Math.floor(Date.now() / 1000) + 300
    const fiveMinutesFromNowIso = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    console.log(
      `[create-subscription] 🚧 TEST TIER OVERRIDE: start_at=${fiveMinutesFromNowSec} (now+5min) ` +
      `trialEndsAtToWrite=${fiveMinutesFromNowIso}`
    )
    startAtSec = fiveMinutesFromNowSec
    trialEndsAtToWrite = fiveMinutesFromNowIso
    scenario = 'test_5min_override'
  } else {
    if (!existingTrialEndsMs) {
      // No trial row yet (trigger didn't fire or row missing) → defensive new-user path
      scenario = 'new'
      startAtSec = Math.floor((nowMs + sevenDaysMs) / 1000)
      trialEndsAtToWrite = new Date(nowMs + sevenDaysMs).toISOString()
    } else if (existingTrialEndsMs > nowMs + minBufferSec * 1000) {
      // Trial still has > 60s remaining → honor existing trial end date
      scenario = 'mid_trial'
      startAtSec = Math.floor(existingTrialEndsMs / 1000)
      trialEndsAtToWrite = null // DO NOT overwrite — keep existing value
    } else {
      // Trial expired OR ending within 60s → start charging as soon as Razorpay allows
      scenario = 'expired'
      startAtSec = Math.floor((nowMs + minBufferSec * 1000) / 1000)
      trialEndsAtToWrite = new Date(nowMs).toISOString() // mark trial ended now
    }
  }

  console.log(
    `[create-subscription] userId=${userId} tier=${tier} cycle=${cycle} scenario=${scenario} ` +
    `start_at=${startAtSec} trialEndsAtToWrite=${trialEndsAtToWrite}`
  )
  // ────────────────────────────────────────────────────────────────────────────

  interface RazorpaySubscription { id: string; short_url: string }
  let subscription: RazorpaySubscription
  try {
    subscription = await (razorpay.subscriptions.create({
      plan_id: planId,
      total_count: totalCount,
      customer_notify: 1,
      start_at: startAtSec,
      notes: {
        user_id: userId,
        tier,
        cycle,
        scenario,
        created_via: 'app',
      },
    }) as unknown as Promise<RazorpaySubscription>)
  } catch (err) {
    const rzpErr = err as { error?: { description?: string; code?: string }; statusCode?: number }
    console.error('[create-subscription] Razorpay error:', JSON.stringify(err, null, 2))
    return res.status(500).json({
      message: rzpErr.error?.description ?? 'Failed to create subscription with payment provider',
      code: rzpErr.error?.code,
      razorpayStatus: rzpErr.statusCode,
    })
  }

  // Write to Supabase — DO NOT blindly overwrite trial_ends_at
  const updates: Record<string, unknown> = {
    razorpay_subscription_id: subscription.id,
    status: 'trialing', // webhook will move to 'active' on subscription.charged
    plan: tier,
    updated_at: new Date().toISOString(),
  }

  // Only overwrite trial_ends_at when scenario explicitly requires it
  if (trialEndsAtToWrite !== null) {
    updates.trial_ends_at = trialEndsAtToWrite
  }

  const { error: updateErr } = await supabaseAdmin
    .from('subscriptions')
    .update(updates)
    .eq('user_id', userId)

  if (updateErr) {
    console.error('[create-subscription] supabase update error:', updateErr)
    // Razorpay subscription already created — do NOT throw; webhook will reconcile DB state
  }

  return res.status(200).json({
    subscriptionId: subscription.id,
    shortUrl: subscription.short_url,
    startAt: startAtSec,
    scenario,
  })
}
