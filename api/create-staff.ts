import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

// Self-contained by design (Phase D locked decision): no relative imports,
// so Node16's .js-extension rule never bites this file. The credential
// generator is duplicated in api/manage-staff.ts on purpose.

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

  const body = (req.body ?? {}) as { name?: unknown }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: 'name is required' })
  }
  if (name.length > 60) {
    return res.status(400).json({ error: 'name too long (max 60 characters)' })
  }

  const clubId = String(caller.club_id)
  const { data: clubData, error: clubError } = await supabase
    .from('clubs')
    .select('slug')
    .eq('id', clubId)
    .maybeSingle()

  if (clubError) {
    console.error('clubs lookup error:', clubError)
    return res.status(500).json({ error: 'Failed to load club' })
  }
  const club = clubData as { slug: string | null } | null
  // Owner may never have set a Player Hub slug — fall back to a club_id prefix.
  const clubSlug = club?.slug || 'c' + clubId.slice(0, 8)

  const namePart = name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'staff'
  const password = randomFromCharset(PASSWORD_CHARSET, 8)

  let email = ''
  let staffUserId = ''
  for (let attempt = 0; attempt < 3 && !staffUserId; attempt++) {
    email = `${namePart}.${randomFromCharset('0123456789', 4)}@${clubSlug}.ck.local`
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // ck_role is what handle_new_user() keys on to SKIP the trial-subscription
      // insert for staff (20260710 migration). Do not omit it.
      user_metadata: { name, ck_role: 'staff' },
    })
    if (createError) {
      // error code string verified against supabase-js 2.106.1 (GoTrue email_exists)
      if (createError.code === 'email_exists') continue // 4-digit collision — regenerate
      console.error('auth.admin.createUser error:', createError)
      return res.status(500).json({ error: 'Failed to create staff account' })
    }
    if (!created.user) {
      return res.status(500).json({ error: 'Failed to create staff account' })
    }
    staffUserId = created.user.id
  }
  if (!staffUserId) {
    return res.status(500).json({ error: 'Could not generate a unique username — try again' })
  }

  // users_meta has no client INSERT policy — service role writes it by design.
  // username denormalized here (#157, 20260719 migration) so the owner-read
  // list can show it — auth.users.email is unreachable via RLS.
  const { error: metaError } = await supabase.from('users_meta').insert({
    user_id: staffUserId,
    role: 'staff',
    club_id: caller.club_id,
    name,
    active: true,
    created_by: user.id,
    username: email,
  })

  if (metaError) {
    console.error('users_meta insert error:', metaError)
    // Compensating action: an auth user without a users_meta row would mint
    // claim-less JWTs (treated as legacy owner client-side). Never leave one.
    const { error: cleanupError } = await supabase.auth.admin.deleteUser(staffUserId)
    if (cleanupError) {
      console.error('compensating deleteUser error:', cleanupError)
    }
    return res.status(500).json({ error: 'Failed to provision staff account' })
  }

  // password is returned ONCE and never stored anywhere else.
  return res.status(200).json({ userId: staffUserId, email, password, name })
}
