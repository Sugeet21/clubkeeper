import { createClient } from '@supabase/supabase-js'
import { readAccessTokenLockFree } from '../db/syncClubId'

// ─── Pattern S16 — owner data-plane client (Chunk 4.3 + Chunk 5.0) ──────────
// Dedicated REST-only Supabase client used by the OWNER DATA PLANE:
//   - SyncRunner.pushOne writes (src/db/syncRunner.ts) — Chunk 4.3
//   - SyncReader.initialPull reads (src/db/syncReader.ts) — Chunk 5.0+
// Configured with the `accessToken` option, which makes supabase-js bypass its
// internal `auth.getSession()` call entirely — no GoTrueClient, no
// `navigator.locks` acquisition, no lock contention with the main `supabase`
// client's own auth machinery.
//
// REASONING ON THE PROMOTION FROM "WRITE-ONLY" TO DATA-PLANE
// The pre-Chunk-5 version of this comment said reads in Chunk 5 might stay on
// the main `supabase` client because "reads are one-shot so the lock won't
// manifest." That is the SAME flawed reasoning class that produced the Chunk
// 4.3 navigator-lock miss — we wrote off the deadlock as unlikely instead of
// removing the lock path. The cure is structural: route the entire owner data
// plane (reads + writes) through this lock-free client and stop reasoning
// about WHEN the lock might or might not bite.
//
// REALTIME STAYS ON THE MAIN `supabase` CLIENT
// supabase-js realtime gets its bearer via `realtime.setAuth(token)` driven by
// `auth.onAuthStateChange` on the MAIN client. supabaseSync has no working
// `.auth` (the Proxy throws), so it cannot drive realtime — and the once-per-
// subscribe handshake on the main client is well-understood, stable, and
// already running (TopupRealtimeBridge / BookingRealtimeBridge for months).
// Realtime's correctness depends on the main client's auth lock staying
// unstranded; Chunk 4.3 secured that. If it ever regresses, realtime token
// refresh stalls and after ~1hr RLS silently filters every event.
//
// WHY THIS EXISTS — full RCA
// The owner E2E hang of Phase C Chunk 4 was a navigator-lock deadlock on the
// owner GoTrueClient. supabase-js v2 takes a global lock keyed off storageKey
// (`lock:${storageKey}`) inside getSession(); the PostgREST path also calls
// `auth.getSession()` internally on every REST request to attach the Bearer
// header (SupabaseClient._getAccessToken → this.auth.getSession()), so every
// `.from(...).upsert(...)` re-acquires the lock too.
//
// The first attempted fix (S16 v1) only patched OUR own call site
// (getOwnerClubIdFromJwt → lock-free) and added distinct storageKey on
// supabasePublic. Verification showed the watchdog STILL fired on a single-
// row drain because supabase-js itself was re-acquiring the lock on every
// REST request. Lesson: fixing only userspace lock acquisitions cannot
// dislodge a library-level lock. The library's escape hatch is the
// `accessToken` option (createClient docs) — when set, supabase-js calls our
// function for the bearer token and never touches its own auth client.
//
// CONSTRAINTS (do not violate — strictly enforced by code review)
// 1. OWNER DATA PLANE ONLY. Imported by `src/db/syncRunner.ts` (writes) and
//    `src/db/syncReader.ts` (reads). No other file may import `supabaseSync`.
//    This invariant is also in ripple_effects.md (Sync section, three-client
//    rule).
// 2. No `.auth` access. The supabase-js Proxy throws on auth access when
//    `accessToken` is set (line 325-333 of SupabaseClient.ts), so this is
//    enforced at runtime too.
// 3. No realtime subscriptions on this client — realtime stays on the main
//    `supabase` client (see header above).
// 4. The accessToken getter MUST be lock-free. `readAccessTokenLockFree`
//    reads in-memory (authStore) then synchronous localStorage. NEVER add
//    an `await supabase.auth.*` here — it would defeat the entire point.
//
// 401 handling
// If the token in storage is stale or expired, supabase-js cannot refresh it
// via this client (no GoTrueClient). The upsert returns a 401 inside the
// `{data, error}` shape; pushOne throws on `error`; drainOnce treats it as
// a transient failure (attempts++, exponential backoff). The MAIN `supabase`
// client's autoRefreshToken keeps the storage token fresh in the background,
// so a 401 here means either (a) we're between refresh cycles — next attempt
// will succeed once autoRefresh fires, or (b) the user has been signed out
// remotely — sign-in flow re-mints. Either way: retryable, NOT dead-letter
// on first hit. Dead-letter is at attempt 10.

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error(
    'Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local',
  )
}

export const supabaseSync = createClient(url, key, {
  // The escape hatch. Setting this disables the internal GoTrueClient lookup
  // and routes the bearer token through OUR lock-free reader for every
  // REST request. supabaseSync.auth is a throwing Proxy — never touch it.
  accessToken: async () => readAccessTokenLockFree(),
})
