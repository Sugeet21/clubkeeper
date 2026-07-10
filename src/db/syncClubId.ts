// Phase C Chunk 4.1 — read user_club_id claim from the JWT.
// Phase C Chunk 4.3 — Pattern S16: lock-free token read.
//
// Every Supabase row needs club_id (RLS partition key, NOT NULL). Dexie rows
// do not carry club_id (one-club-per-device assumption). SyncRunner.pushOne
// stamps it on the wire payload via toSupabaseRow().
//
// The claim is embedded in the JWT by the custom-access-token hook we
// patched in #109 (Pattern A9). Format: `claims.user_club_id` is the UUID
// string of the owner's club.
//
// ─── Pattern S16 — Lock-free token read (PART OF the sync-deadlock fix) ─────
// In supabase-js v2, GoTrueClient.getSession() acquires a navigator.locks
// lock keyed off storageKey (`lock:${storageKey}`). Fixing only THIS call
// site was the first attempt and was INSUFFICIENT: supabase-js's PostgREST
// path (SupabaseClient._getAccessToken → this.auth.getSession()) ALSO calls
// getSession() on every REST request to attach the Bearer header — that
// re-acquires the same lock. The real cure is the dedicated `supabaseSync`
// client (src/lib/supabaseSync.ts) configured with the `accessToken` option,
// which bypasses GoTrueClient entirely. This file still exists for the
// clubId/JWT-claim read and as the lock-free token source supabaseSync's
// accessToken getter uses.

import { useAuthStore } from '../store/authStore'

let cached: { token: string; clubId: string } | null = null
let expiryWarned = false

/**
 * Thrown by `getOwnerClubIdFromJwt` when the current access_token exists but
 * has no `user_club_id` claim. Callers (SyncReader especially) check this
 * with `instanceof NoUserClubIdClaimError` to distinguish a fixable
 * configuration issue from a transient failure. `instanceof` is used instead
 * of message-string matching so the guidance text can be rewritten later
 * without silently breaking the reader's deferral logic.
 */
export class NoUserClubIdClaimError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoUserClubIdClaimError'
    // Preserve prototype chain across the ES5 transpile target so `instanceof`
    // works even when this file is bundled through tsc's older output.
    Object.setPrototypeOf(this, NoUserClubIdClaimError.prototype)
  }
}

/**
 * Returns the owner's club_id from the JWT user_club_id claim.
 * Lock-free — never calls supabase.auth.getSession().
 * @throws Error if there's no signed-in session, or the JWT has no claim.
 */
export async function getOwnerClubIdFromJwt(): Promise<string> {
  // #116 runtime-proof toggle — DEV builds only, stripped from prod by the
  // import.meta.env.DEV guard. Simulates a broken custom-access-token hook
  // (JWT minted without user_club_id) so SyncReader's deferForRefresh
  // single-fire path can be exercised repeatably from the console:
  //   localStorage.setItem('__force_no_claim__', '1')  → reload
  //   localStorage.removeItem('__force_no_claim__')    → refreshSession()
  // Checked BEFORE the cache so a cached clubId can't mask the toggle.
  if (import.meta.env.DEV && localStorage.getItem('__force_no_claim__') === '1') {
    throw new NoUserClubIdClaimError(
      'DEV __force_no_claim__ toggle is set — simulating a JWT with no user_club_id claim (#116 test plan). localStorage.removeItem("__force_no_claim__") to restore.',
    )
  }

  const token = readAccessTokenLockFree()
  if (!token) {
    throw new Error('getOwnerClubIdFromJwt: no signed-in session (no access_token in memory or storage)')
  }

  if (cached && cached.token === token) return cached.clubId

  const claims = decodeJwtClaims(token)

  // Best-effort expiry warn — do NOT block. supabase-js refreshes in the
  // background; if the token is genuinely rejected, the eventual upsert in
  // pushOne surfaces a real auth error and the row attempts++.
  if (!expiryWarned && typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    expiryWarned = true
    // eslint-disable-next-line no-console
    console.warn('[syncClubId] access_token appears expired; relying on supabase-js to refresh on next call')
  }

  const clubId = typeof claims.user_club_id === 'string' ? claims.user_club_id : null
  if (!clubId) {
    // Configuration issue, not a transient failure. Two known root causes:
    //   (a) The user has no row in public.users_meta, so the hook returns
    //       the JWT unmodified (see add_user_meta_to_jwt at line 139 of the
    //       Phase C schema migration).
    //   (b) The Supabase project has never had the Custom Access Token Hook
    //       enabled at Dashboard → Auth → Hooks (must point at
    //       public.add_user_meta_to_jwt), so no token has ever been minted
    //       with the claim.
    // Neither is fixed by signing out and back in — that dance was previously
    // suggested here and it MASKED the real bug (Pattern A9 / #109
    // regression). SyncReader detects this specific error via `instanceof
    // NoUserClubIdClaimError` and defers the pull, retrying automatically
    // on the next `TOKEN_REFRESHED` event once the owner has fixed the
    // configuration on Supabase's side.
    throw new NoUserClubIdClaimError(
      "JWT has no user_club_id claim. Either the signed-in user has no row in public.users_meta, or the Custom Access Token Hook is not enabled in Supabase Dashboard → Auth → Hooks (must be set to public.add_user_meta_to_jwt). Pattern A9 / #109. SyncReader will retry automatically when the token refreshes.",
    )
  }
  cached = { token, clubId }
  return clubId
}

/** Test/dev hook — clears the cache. */
export function _resetClubIdCache(): void {
  cached = null
  expiryWarned = false
}

// ─── Internals / shared lock-free token reader ──────────────────────────────

/** Lock-free read of the current owner access_token. In-memory first
 *  (authStore.session.access_token), then synchronous localStorage fallback.
 *  Never touches supabase.auth → never acquires GoTrueClient's lock.
 *  Used both by `getOwnerClubIdFromJwt` and by `supabaseSync`'s accessToken
 *  getter. Returns `null` if nothing is signed in. */
export function readAccessTokenLockFree(): string | null {
  // 1. Prefer the in-memory session held by authStore. SyncRunnerBoot only
  //    starts the runner once `session` is truthy in the store, so on the hot
  //    path this branch always hits and zero localStorage / lock work occurs.
  const fromStore = useAuthStore.getState().session?.access_token ?? null
  if (fromStore) return fromStore

  // 2. Fallback — synchronous localStorage read. Pinned to supabase-js v2's
  //    `sb-<projectRef>-auth-token` scheme. If a future major version of
  //    supabase-js changes this scheme, this function fails closed
  //    (returns null → caller throws "no signed-in session") rather than
  //    silently hanging. Owner sees the stuck row in TestOutbox.
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
    if (!url) return null
    const projectRef = new URL(url).hostname.split('.')[0]
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { access_token?: string } | null
    return parsed?.access_token ?? null
  } catch {
    return null
  }
}

export interface JwtClaims {
  user_club_id?: unknown
  user_role?: unknown
  exp?: unknown
  [k: string]: unknown
}

// Exported for Phase D (D3): deriveRole in src/hooks/useRole.ts reads the
// user_role claim through this same lock-free decoder. Returns {} on any
// malformed token — callers must treat missing claims as "not present".
export function decodeJwtClaims(token: string): JwtClaims {
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
