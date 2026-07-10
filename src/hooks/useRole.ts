// Phase D (D3) — client role state, derived from the user_role JWT claim.
//
// Role source of truth on the client = the JWT claim, decoded LOCK-FREE from
// session.access_token (Pattern S16 — never supabase.auth.*, which queues on
// the GoTrue navigator lock). The claim is stamped at token mint by the
// add_user_meta_to_jwt hook reading users_meta; staff ALWAYS have a users_meta
// row, so a live session whose token has no/invalid user_role claim can only
// be a legacy/unprovisioned owner → treated as 'owner' (sync is already off
// for them via the missing user_club_id claim).

import type { Session } from '@supabase/supabase-js'
import { decodeJwtClaims } from '../db/syncClubId'
import { useAuthStore } from '../store/authStore'

export type Role = 'owner' | 'staff' | null

/**
 * Pure helper: derive the role from a session. null session → null (signed
 * out). Used by authStore at every point it sets `session`, so the store's
 * `role` field is always in lockstep with the session.
 */
export function deriveRole(session: Session | null): Role {
  const token = session?.access_token
  if (!token) return null
  const claims = decodeJwtClaims(token)
  return claims.user_role === 'staff' ? 'staff' : 'owner'
}

/**
 * Read the current role from the store. NO Supabase query, NO users_meta
 * fetch — the role resolves synchronously with the session, so render-time
 * gates never flicker.
 */
export function useRole(): Role {
  return useAuthStore((s) => s.role)
}
