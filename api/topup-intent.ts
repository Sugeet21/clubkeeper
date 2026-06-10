// POST /api/topup-intent
// Request:  { slug: string, playerName?: string, playerMobile: string, amount: number }
// Success:  { intentId: string }
// Error:    { message: string }
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { slug, playerName, playerMobile, amount } = req.body as {
    slug?: string
    playerName?: string
    playerMobile?: string
    amount?: number
  }

  if (!slug || !playerMobile || amount === undefined) {
    return res.status(400).json({ message: 'Missing required fields: slug, playerMobile, amount' })
  }

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 100 || amount > 10000) {
    return res.status(400).json({ message: 'Amount must be an integer between ₹100 and ₹10,000' })
  }

  if (!/^[6-9][0-9]{9}$/.test(playerMobile)) {
    return res.status(400).json({ message: 'Invalid mobile number. Must be 10 digits starting with 6-9.' })
  }

  const { data, error } = await supabaseAdmin.rpc('submit_topup_intent', {
    p_slug: slug,
    p_player_name: playerName ?? '',
    p_player_mobile: playerMobile,
    p_amount: amount,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('club_not_found')) {
      return res.status(404).json({ message: 'Club not found for this QR code.' })
    }
    if (msg.includes('topups_disabled')) {
      return res.status(403).json({ message: 'Top-ups are currently disabled at this club.' })
    }
    if (msg.includes('rate_limited')) {
      return res.status(429).json({ message: 'Please wait a few minutes before trying again.' })
    }
    console.error('[topup-intent] rpc error', error)
    return res.status(500).json({ message: 'Failed to submit. Please try again.' })
  }

  return res.status(200).json({ intentId: data as string })
}
