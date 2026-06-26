// Phase C Chunk 4.1 — read user_club_id claim from the JWT.
//
// Every Supabase row needs club_id (RLS partition key, NOT NULL). Dexie rows
// do not carry club_id (one-club-per-device assumption). SyncRunner.pushOne
// stamps it on the wire payload via toSupabaseRow().
//
// The claim is embedded in the JWT by the custom-access-token hook we
// patched in #109 (Pattern A9). Format: `claims.user_club_id` is the UUID
// string of the owner's club.
//
// We cache the parsed claim per access_token. supabase.auth.getSession()
// is cheap (reads the local TokenManager), but jwt-base64-decode is even
// cheaper, and called once per push batch this is irrelevant.
//
// If the JWT is missing the claim (auth hook not configured yet, or a
// stale pre-#109 session), we throw — SyncRunner treats it like any other
// pushOne error (attempts++ → backoff → dead-letter). Owner sees the stuck
// row + lastError on TestOutbox → re-signs in to refresh JWT.

import { supabase } from '../lib/supabase'

let cached: { token: string; clubId: string } | null = null

/**
 * Returns the owner's club_id from the JWT user_club_id claim.
 * @throws Error if there's no signed-in session, or the JWT has no claim.
 */
export async function getOwnerClubIdFromJwt(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(`getOwnerClubIdFromJwt: ${error.message}`)
  const token = data.session?.access_token
  if (!token) {
    throw new Error('getOwnerClubIdFromJwt: no signed-in session')
  }

  if (cached && cached.token === token) return cached.clubId

  const claims = decodeJwtClaims(token)
  const clubId = typeof claims.user_club_id === 'string' ? claims.user_club_id : null
  if (!clubId) {
    throw new Error(
      'getOwnerClubIdFromJwt: JWT has no user_club_id claim — sign out and back in to refresh the token (Pattern A9 / #109)',
    )
  }
  cached = { token, clubId }
  return clubId
}

/** Test/dev hook — clears the cache. */
export function _resetClubIdCache(): void {
  cached = null
}

// ─── Internals ──────────────────────────────────────────────────────────────

interface JwtClaims {
  user_club_id?: unknown
  user_role?: unknown
  [k: string]: unknown
}

function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split('.')
  if (parts.length !== 3) return {}
  try {
    // base64url → base64 → bytes → utf-8 string → JSON
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json) as JwtClaims
  } catch {
    return {}
  }
}
