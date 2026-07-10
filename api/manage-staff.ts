import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

// Self-contained by design (Phase D locked decision): no relative imports,
// so Node16's .js-extension rule never bites this file. The credential
// generator is duplicated from api/create-staff.ts on purpose.

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Unambiguous charset — no 0/O/1/l/I; credentials are handed to staff on paper (§3.3).
const PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

// Uniform sampling via rejection over crypto.randomBytes — never Math.random.
function randomFromCharset(charset: string, length: number): string {
  const limit = Math.floor(256 / charset.length) * charset.length
  let out = ''
  while (out.length < length) {
    const bytes = randomBytes(length * 2)
    for (const b of bytes) {
      if (b < limit && out.length < length) out += charset[b % charset.length]
    }
  }
  return out
}

type UsersMetaRow = { role: string; club_id: string; active: boolean }

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

  // The service-role client bypasses RLS — this explicit query IS the
  // authorization check. Never remove it.
  const { data: callerData, error: callerError } = await supabase
    .from('users_meta')
    .select('role, club_id, active')
    .eq('user_id', user.id)
    .maybeSingle()

  if (callerError) {
    console.error('users_meta caller lookup error:', callerError)
    return res.status(500).json({ error: 'Failed to load caller profile' })
  }
  const caller = callerData as UsersMetaRow | null
  if (!caller || caller.role !== 'owner' || caller.active !== true) {
    return res.status(403).json({ error: 'Owner account required' })
  }

  const body = (req.body ?? {}) as { action?: unknown; staffUserId?: unknown }
  const action = body.action
  const staffUserId = typeof body.staffUserId === 'string' ? body.staffUserId : ''
  if (action !== 'revoke' && action !== 'reset_password') {
    return res.status(400).json({ error: "action must be 'revoke' or 'reset_password'" })
  }
  if (!staffUserId) {
    return res.status(400).json({ error: 'staffUserId is required' })
  }

  const { data: targetData, error: targetError } = await supabase
    .from('users_meta')
    .select('role, club_id, active')
    .eq('user_id', staffUserId)
    .maybeSingle()

  if (targetError) {
    console.error('users_meta target lookup error:', targetError)
    return res.status(500).json({ error: 'Failed to load staff account' })
  }
  const target = targetData as UsersMetaRow | null
  if (!target) {
    return res.status(404).json({ error: 'Staff account not found' })
  }
  // An owner can never touch an owner, or anyone outside their own club.
  if (target.role !== 'staff' || String(target.club_id) !== String(caller.club_id)) {
    return res.status(403).json({ error: 'Not a staff account in your club' })
  }

  if (action === 'revoke') {
    // active=false is the primary kill: the access-token hook raises on it at
    // every mint (including refresh), so no new JWT is ever issued.
    const { error: revokeError } = await supabase
      .from('users_meta')
      .update({ active: false })
      .eq('user_id', staffUserId)
    if (revokeError) {
      console.error('users_meta revoke update error:', revokeError)
      return res.status(500).json({ error: 'Failed to revoke staff account' })
    }

    // Belt-and-braces: ban kills the refresh token too. supabase-js 2.106.1
    // has no admin invalidate-sessions-by-user-id (admin.signOut needs the
    // TARGET's JWT, which the server never holds — checked GoTrueAdminApi.d.ts).
    // Residual access = live JWT TTL ≤1h, the accepted §4.5 trade-off.
    const { error: banError } = await supabase.auth.admin.updateUserById(staffUserId, {
      ban_duration: '87600h',
    })
    if (banError) {
      console.error('auth.admin ban error:', banError)
      // active=false already blocks all future token mints; retrying revoke is safe.
      return res.status(500).json({ error: 'Account deactivated but session ban failed — run revoke again' })
    }

    return res.status(200).json({ revoked: true })
  }

  // action === 'reset_password'
  if (target.active !== true) {
    return res.status(409).json({ error: 'Cannot reset password for a removed account' })
  }

  const password = randomFromCharset(PASSWORD_CHARSET, 8)
  const { error: resetError } = await supabase.auth.admin.updateUserById(staffUserId, {
    password,
  })
  if (resetError) {
    console.error('auth.admin password reset error:', resetError)
    return res.status(500).json({ error: 'Failed to reset password' })
  }

  // password is returned ONCE and never stored anywhere else.
  return res.status(200).json({ password })
}
