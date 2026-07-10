// #120 — lock-free boot fallback for a stranded GoTrue navigator lock.
//
// supabase-js v2 GoTrueClient serializes every auth call behind
// `lock:sb-<projectRef>-auth-token` (Web Locks API). A zombie browser context
// that dies while holding the lock strands it: every getSession() in every
// new tab queues forever and the app never leaves "Loading…" (#120).
// Worse, supabase-js 2.106.1 forwards `lockAcquireTimeout: undefined` into
// GoTrueClient's Object.assign options merge, clobbering the library's own
// 5000ms steal-recovery default — so the built-in recovery never runs.
//
// This module gives authStore.initialize() a way to boot WITHOUT the lock:
// read the persisted session straight from localStorage (same scheme as
// readAccessTokenLockFree in syncClubId.ts — Pattern S16) and fetch the
// profile + subscription rows over plain fetch() with the stored bearer.
// It only ever READS. It never refreshes tokens, never writes storage, and
// never creates a GoTrueClient — so it cannot race the (queued) main
// client's refresh machinery and cannot invalidate the refresh-token family.
// Deliberately NO steal anywhere: a steal fired against a healthy-but-slow
// holder mid-refresh can rotate the same refresh token twice and sign the
// owner out of every tab in the browser.

import type { Session } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Minimum remaining validity for a stored token to be trusted for a
 *  degraded boot. A token about to expire can't be refreshed lock-free
 *  (refreshing outside the client is exactly the forbidden race), so we
 *  only boot degraded when there's comfortable runway. */
const MIN_TOKEN_RUNWAY_MS = 60_000

/** REST fetch timeout for the degraded profile/subscription reads (Pattern S1). */
const REST_TIMEOUT_MS = 10_000

function projectRef(): string | null {
  try {
    if (!SUPABASE_URL) return null
    return new URL(SUPABASE_URL).hostname.split('.')[0]
  } catch {
    return null
  }
}

/** The exact navigator lock name GoTrueClient uses for the main client.
 *  Exported for diagnostics and the #120 runtime proof. */
export function gotrueLockName(): string | null {
  const ref = projectRef()
  return ref ? `lock:sb-${ref}-auth-token` : null
}

/**
 * Lock-free read of the FULL persisted session (not just the access_token —
 * that's readAccessTokenLockFree's job in syncClubId.ts, kept separate so
 * the sync plane stays untouched). Returns null unless the stored JSON is
 * structurally a session AND the access token has ≥60s of validity left —
 * an expired token would just 401 every REST call and mislead the user.
 */
export function readStoredSessionLockFree(): Session | null {
  try {
    const ref = projectRef()
    if (!ref) return null
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const s = parsed as Record<string, unknown>
    const user = s.user as Record<string, unknown> | undefined
    if (
      typeof s.access_token !== 'string' ||
      typeof s.refresh_token !== 'string' ||
      typeof s.expires_at !== 'number' ||
      typeof user !== 'object' ||
      user === null ||
      typeof user.id !== 'string'
    ) {
      return null
    }
    if (s.expires_at * 1000 < Date.now() + MIN_TOKEN_RUNWAY_MS) return null
    // Structurally validated above — the stored value IS the Session object
    // supabase-js persisted, so the cast is a checked boundary, not a guess.
    return parsed as Session
  } catch {
    return null
  }
}

/**
 * Best-effort diagnostic: is the GoTrue lock currently held by some other
 * context? Used only for logging/telemetry on the timeout path — the boot
 * decision rests on the stored session, not on this.
 */
export async function isAuthLockHeldByAnotherContext(): Promise<boolean> {
  try {
    const name = gotrueLockName()
    if (!name || !navigator.locks?.query) return false
    const state = await navigator.locks.query()
    return (state.held ?? []).some((l) => l.name === name)
  } catch {
    return false
  }
}

// Raw PostgREST row shapes for the two boot reads. Kept minimal — only the
// columns authStore's mappers consume.
export interface ProfileRow {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  club_name: string | null
  created_at: string
}

export interface SubscriptionRow {
  id: string
  user_id: string
  status: string
  plan: string
  trial_ends_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  razorpay_customer_id: string | null
  razorpay_subscription_id: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

async function restGet<T>(pathAndQuery: string, accessToken: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('authBootFallback: missing Supabase env vars')
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!res.ok) {
      throw new Error(`authBootFallback: REST ${pathAndQuery.split('?')[0]} failed with ${res.status}`)
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new Error('authBootFallback: bad JSON from REST')
    }
    if (!Array.isArray(body)) throw new Error('authBootFallback: expected array from REST')
    return body as T[]
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('authBootFallback: REST request timed out')
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

/**
 * Fetch the signed-in owner's profile + latest subscription row over plain
 * fetch() — no supabase-js client involved, so no navigator lock. RLS scopes
 * both tables to the bearer's own rows (same rows refreshProfile reads).
 *
 * D3: `skipSubscription` is set for a STAFF degraded boot — the subscriptions
 * table is user_id-scoped so a staff bearer gets zero rows anyway; the staff
 * gate uses the get_club_subscription_status RPC, which stays owner-shaped
 * out of this lock-free path (staff degraded boot runs with subscription
 * null and re-checks on recovery).
 */
export async function fetchProfileAndSubscriptionRows(
  userId: string,
  accessToken: string,
  opts: { skipSubscription?: boolean } = {},
): Promise<{ profileRow: ProfileRow | null; subscriptionRow: SubscriptionRow | null }> {
  const uid = encodeURIComponent(userId)
  const [profiles, subscriptions] = await Promise.all([
    restGet<ProfileRow>(`profiles?select=*&id=eq.${uid}&limit=1`, accessToken),
    opts.skipSubscription
      ? Promise.resolve([] as SubscriptionRow[])
      : restGet<SubscriptionRow>(
          `subscriptions?select=*&user_id=eq.${uid}&order=created_at.desc&limit=1`,
          accessToken,
        ),
  ])
  return { profileRow: profiles[0] ?? null, subscriptionRow: subscriptions[0] ?? null }
}
