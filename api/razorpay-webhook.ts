import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type RazorpaySubscriptionPayload = {
  id: string
  current_start: number | null
  current_end: number | null
  status: string
}

type WebhookEventPayload = {
  event: string
  payload: {
    subscription: {
      entity: RazorpaySubscriptionPayload
    }
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
}

async function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString() })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rawBody = await getRawBody(req)
  const signature = req.headers['x-razorpay-signature'] as string | undefined

  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' })
  }

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook not configured' })
  }

  const expectedSig = createHmac('sha256', secret).update(rawBody).digest('hex')
  if (expectedSig !== signature) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let event: WebhookEventPayload
  try {
    event = JSON.parse(rawBody) as WebhookEventPayload
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  const sub = event.payload?.subscription?.entity
  if (!sub?.id) {
    return res.status(200).json({ received: true })
  }

  const razorpaySubId = sub.id
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  switch (event.event) {
    case 'subscription.authenticated':
      updates.status = 'trialing'
      break

    case 'subscription.activated':
    case 'subscription.charged':
      updates.status = 'active'
      if (sub.current_start) {
        updates.current_period_start = new Date(sub.current_start * 1000).toISOString()
      }
      if (sub.current_end) {
        updates.current_period_end = new Date(sub.current_end * 1000).toISOString()
      }
      break

    case 'subscription.halted':
      updates.status = 'past_due'
      break

    case 'subscription.cancelled':
      updates.status = 'cancelled'
      updates.cancel_at_period_end = false
      break

    case 'subscription.completed':
      updates.status = 'expired'
      break

    default:
      // Unknown event — return 200 so Razorpay doesn't retry
      return res.status(200).json({ received: true })
  }

  const { error } = await supabase
    .from('subscriptions')
    .update(updates)
    .eq('razorpay_subscription_id', razorpaySubId)

  if (error) {
    console.error('Webhook Supabase update error:', error)
    // Still return 200 — don't trigger retries for DB errors; monitor logs instead
  }

  return res.status(200).json({ received: true })
}
