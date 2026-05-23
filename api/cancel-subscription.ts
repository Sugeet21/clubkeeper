import type { VercelRequest, VercelResponse } from '@vercel/node'
import Razorpay from 'razorpay'
import { createClient } from '@supabase/supabase-js'

const razorpay = new Razorpay({
  key_id: process.env.VITE_RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' })
  }
  const token = authHeader.slice(7)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid auth token' })
  }

  const { data: sub, error: subError } = await supabase
    .from('subscriptions')
    .select('razorpay_subscription_id, status')
    .eq('user_id', user.id)
    .single()

  if (subError || !sub) {
    return res.status(404).json({ error: 'Subscription not found' })
  }

  if (!sub.razorpay_subscription_id) {
    return res.status(400).json({ error: 'No active Razorpay subscription' })
  }

  try {
    await razorpay.subscriptions.cancel(sub.razorpay_subscription_id, 1)
  } catch (err) {
    console.error('Razorpay cancel error:', err)
    return res.status(500).json({ error: 'Failed to cancel subscription with payment provider' })
  }

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  if (updateError) {
    console.error('Supabase cancel update error:', updateError)
    return res.status(500).json({ error: 'Failed to update cancellation record' })
  }

  return res.status(200).json({ cancelled: true })
}
