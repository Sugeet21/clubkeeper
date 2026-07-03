import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'
import type { UserProfile, Subscription } from '../types'
import { initDbForUser, closeDb } from '../db/database'
import { seedIfEmpty } from '../db/seed'
import { syncRunner } from '../db/syncRunner'
import { _resetClubIdCache } from '../db/syncClubId'
import { _resetClubSyncSentinel } from '../hooks/useLiveData'
import {
  readStoredSessionLockFree,
  fetchProfileAndSubscriptionRows,
  isAuthLockHeldByAnotherContext,
  type ProfileRow,
  type SubscriptionRow,
} from '../lib/authBootFallback'
import { useToastStore } from './toastStore'

interface AuthState {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  subscription: Subscription | null
  loading: boolean
  dbReady: boolean           // true once initDbForUser + seed complete for current user
  subscriptionLoaded: boolean // true once refreshProfile() has resolved at least once
  authLockBlocked: boolean   // #120 — a stranded GoTrue navigator lock is jamming auth calls.
                             // UI-only (RequireAccess hint + toast); useAccessGuard never reads it.
  _lastFetchedAt: number     // epoch ms; 0 = never fetched
  initialize: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: (force?: boolean) => Promise<void>
}

// Minimum ms between automatic refreshProfile calls. Prevents double-fetch
// from initialize() + the synchronous onAuthStateChange INITIAL_SESSION event
// that Supabase fires immediately when the listener is registered.
// Post-payment refresh (Subscribe.tsx) uses force=true to bypass this guard.
const REFRESH_COOLDOWN_MS = 3000

// ─── Helper: open per-user DB + seed ─────────────────────────────────────────
// Called from both initialize() and onAuthStateChange. Idempotent:
// initDbForUser no-ops if already open on the same DB (Pattern A1 safety).

async function openAndSeed(userId: string): Promise<void> {
  await initDbForUser(userId)
  await seedIfEmpty()
}

// ─── #120: getSession() vs stranded-navigator-lock race ─────────────────────
// A healthy getSession() resolves in milliseconds (storage read) — the only
// slow-but-healthy case is a token refresh on bad network, and then the
// stored token is expired so the degraded branch refuses it anyway. 8s of
// silence with a fresh stored token therefore means the GoTrue lock is
// jammed by another context (#120's zombie tab), not a slow network.
const GETSESSION_TIMEOUT_MS = 8000

const GETSESSION_TIMED_OUT = Symbol('getSessionTimedOut')

// StrictMode dedup — AuthInitializer's effect fires initialize() twice in
// DEV, so two racers can both time out. Only the first may run the degraded
// boot (state sets are idempotent, but the toast would duplicate). Module
// state survives soft navs; sign-out's hard nav (window.location.href)
// reloads the module, and signOut() also resets it defensively.
let degradedBootStarted = false

export function _resetDegradedBootGuard(): void {
  degradedBootStarted = false
}

async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof GETSESSION_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof GETSESSION_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(GETSESSION_TIMED_OUT), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ─── Row → domain mappers ────────────────────────────────────────────────────
// Single source of truth for the snake_case → camelCase mapping, shared by
// refreshProfile (supabase-js path) and the #120 degraded boot (plain-fetch
// path) so the two can never drift.

function mapProfileRow(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    clubName: row.club_name,
    createdAt: new Date(row.created_at).getTime(),
  }
}

function mapSubscriptionRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as Subscription['status'],
    plan: row.plan as Subscription['plan'],
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : null,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start).getTime() : null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
    razorpayCustomerId: row.razorpay_customer_id,
    razorpaySubscriptionId: row.razorpay_subscription_id,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  subscription: null,
  loading: true,
  dbReady: false,
  subscriptionLoaded: false,
  authLockBlocked: false,
  _lastFetchedAt: 0,

  initialize: async () => {
    console.log('[authStore] initialize start')
    try {
      // #120 — getSession() queues on the GoTrue navigator lock. If a zombie
      // context strands that lock, this await never settles and the app is
      // an eternal spinner. Race it against a timeout; on timeout boot from
      // the persisted session WITHOUT the lock (read-only — never steal, a
      // steal can race a healthy holder's refresh and rotate the same
      // refresh token twice, signing the owner out of every tab).
      const sessionPromise = supabase.auth.getSession()
      const raced = await raceWithTimeout(sessionPromise, GETSESSION_TIMEOUT_MS)

      let degradedBooted = false
      let result: Awaited<typeof sessionPromise>

      if (raced === GETSESSION_TIMED_OUT) {
        const lockHeld = await isAuthLockHeldByAnotherContext()
        console.warn(
          `[authStore] getSession() still pending after ${GETSESSION_TIMEOUT_MS}ms — ` +
            `GoTrue lock ${lockHeld ? 'IS held by another context (#120 jam confirmed)' : 'state inconclusive'}`,
        )
        set({ authLockBlocked: true })

        // The pending getSession() stays queued on the lock. Its eventual
        // resolution — when the zombie tab dies or releases — is the
        // recovery signal. The onAuthStateChange handler below (registered
        // either way) then re-runs the normal path idempotently (Pattern A1);
        // here we only clear the banner.
        void sessionPromise
          .then(() => {
            console.log('[authStore] queued getSession() finally resolved — lock freed, clearing #120 banner')
            if (get().authLockBlocked) {
              set({ authLockBlocked: false })
              useToastStore.getState().show({ message: 'Sign-in unblocked — session restored', type: 'success' })
            }
          })
          .catch(() => {
            // On the degraded-booted path nothing else awaits this promise,
            // so a rejection would otherwise leave the flag stuck forever.
            // (On the non-degraded path the `await sessionPromise` below
            // re-throws into the outer catch as before.)
            set({ authLockBlocked: false })
          })

        const stored = degradedBootStarted ? null : readStoredSessionLockFree()
        if (stored) {
          degradedBootStarted = true
          // Degraded boot: render the app from the persisted session. All
          // reads here are lock-free (localStorage + plain fetch); the main
          // client's queued machinery stays the only token writer.
          try {
            const { profileRow, subscriptionRow } = await fetchProfileAndSubscriptionRows(
              stored.user.id,
              stored.access_token,
            )
            set({
              session: stored,
              user: stored.user,
              profile: profileRow ? mapProfileRow(profileRow) : null,
              subscription: subscriptionRow ? mapSubscriptionRow(subscriptionRow) : null,
              subscriptionLoaded: true,
            })
            await openAndSeed(stored.user.id)
            set({ dbReady: true })
            degradedBooted = true
            console.warn('[authStore] #120 degraded boot complete — running from stored session, lock still jammed')
            useToastStore.getState().show({
              message:
                'Another ClubKeeper tab is blocking sign-in — running from your last saved session. Close other ClubKeeper tabs if this persists.',
              type: 'info',
              durationMs: 12000,
            })
          } catch (fallbackErr) {
            // Lock jammed AND the lock-free reads failed (offline?). Nothing
            // safe left to try — fall through to waiting on the real
            // getSession(), banner explains the stall.
            console.error('[authStore] #120 degraded boot failed, waiting on the jammed getSession()', fallbackErr)
          }
        } else {
          console.warn('[authStore] #120: no fresh stored session — cannot boot degraded, waiting on the jammed getSession()')
        }
      }

      if (!degradedBooted) {
        // Normal path — either the race was won (healthy boot, unchanged
        // behavior) or degraded boot wasn't possible and we wait like the
        // pre-#120 code did (Pattern A5's finally still owns `loading`).
        result = raced === GETSESSION_TIMED_OUT ? await sessionPromise : raced
        const { data: { session }, error } = result
        console.log('[authStore] getSession result', { hasSession: !!session, error })
        set({ session, user: session?.user ?? null, authLockBlocked: false })

        if (session?.user) {
          await get().refreshProfile()
          set({ subscriptionLoaded: true })
          await openAndSeed(session.user.id)
          set({ dbReady: true })
        }
      }

      console.log('[authStore] initialize done', {
        profile: !!get().profile,
        subscription: get().subscription?.status,
        dbReady: get().dbReady,
        degraded: degradedBooted,
      })
    } catch (err) {
      console.error('[authStore] initialize error', err)
    } finally {
      // Pattern A5: loading flag MUST clear in finally — any throw above
      // would leave the app frozen on the spinner without this.
      set({ loading: false })
      console.log('[authStore] initialize complete, loading=false')
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[authStore] onAuthStateChange', { event: _event, hasSession: !!session })
      set({ session, user: session?.user ?? null })

      if (session?.user) {
        await get().refreshProfile()
        set({ subscriptionLoaded: true })
        // initDbForUser is idempotent — safe to call on every INITIAL_SESSION
        // re-fire without closing/reopening the connection (Pattern A1).
        await openAndSeed(session.user.id)
        set({ dbReady: true })
      } else {
        // Sign-out: close the per-user DB, reset state.
        await closeDb()
        set({ profile: null, subscription: null, dbReady: false, subscriptionLoaded: false })
      }
    })
  },

  refreshProfile: async (force = false) => {
    const user = get().user
    if (!user) return

    // Deduplicate: skip if called within the cooldown window (unless forced)
    if (!force) {
      const msSinceLast = Date.now() - get()._lastFetchedAt
      if (msSinceLast < REFRESH_COOLDOWN_MS) return
    }
    set({ _lastFetchedAt: Date.now() })

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    set({
      profile: profile ? mapProfileRow(profile as ProfileRow) : null,
      subscription: subscription ? mapSubscriptionRow(subscription as SubscriptionRow) : null,
    })
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
        queryParams: { prompt: 'select_account' },
      },
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    // Chunk 4.3 / Pattern S15 + S16 — tear DOWN sync state BEFORE closeDb().
    // Order matters: stop()/generation-bump first guarantees that any
    // in-flight drainOnce bails at its next post-await guard, so no orphan
    // tries to touch the DB while/after we're closing it. Reset the two
    // module-level caches that survive a sign-out (clubId per-token, club
    // sync per-user sentinel) so the next sign-in re-pulls cleanly.
    syncRunner.stop()
    _resetClubIdCache()
    _resetClubSyncSentinel()
    _resetDegradedBootGuard()
    // closeDb() is also called by onAuthStateChange on null session (Step 2),
    // but calling it here first is safe (idempotent) and ensures the DB is
    // closed before any redirect clears component state.
    await closeDb()
    set({ session: null, user: null, profile: null, subscription: null, loading: false, dbReady: false, subscriptionLoaded: false, authLockBlocked: false })
    // Hard navigation clears all React + Zustand + Dexie state in one shot.
    // navigate() is intentionally avoided here — stale store state can survive
    // a soft nav and cause the user to remain visually "logged in".
    window.location.href = '/'
  },
}))
