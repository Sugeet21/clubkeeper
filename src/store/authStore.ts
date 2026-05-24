import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'
import type { UserProfile, Subscription } from '../types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  subscription: Subscription | null
  loading: boolean
  _lastFetchedAt: number  // epoch ms; 0 = never fetched
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

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  subscription: null,
  loading: true,
  _lastFetchedAt: 0,

  initialize: async () => {
    console.log('[authStore] initialize start')
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      console.log('[authStore] getSession result', { hasSession: !!session, error })
      set({ session, user: session?.user ?? null })

      if (session?.user) {
        await get().refreshProfile()
      }

      console.log('[authStore] refreshProfile done', {
        profile: !!get().profile,
        subscription: get().subscription?.status,
      })
    } catch (err) {
      console.error('[authStore] initialize error', err)
    } finally {
      set({ loading: false })
      console.log('[authStore] initialize complete, loading=false')
    }

    supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('[authStore] onAuthStateChange', { event: _event, hasSession: !!session })
      set({ session, user: session?.user ?? null })
      if (session?.user) {
        await get().refreshProfile()
      } else {
        set({ profile: null, subscription: null })
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
      profile: profile
        ? {
            id: profile.id,
            email: profile.email,
            displayName: profile.display_name,
            avatarUrl: profile.avatar_url,
            clubName: profile.club_name,
            createdAt: new Date(profile.created_at).getTime(),
          }
        : null,
      subscription: subscription
        ? {
            id: subscription.id,
            userId: subscription.user_id,
            status: subscription.status,
            plan: subscription.plan,
            trialEndsAt: subscription.trial_ends_at
              ? new Date(subscription.trial_ends_at).getTime()
              : null,
            currentPeriodStart: subscription.current_period_start
              ? new Date(subscription.current_period_start).getTime()
              : null,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end).getTime()
              : null,
            razorpayCustomerId: subscription.razorpay_customer_id,
            razorpaySubscriptionId: subscription.razorpay_subscription_id,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            createdAt: new Date(subscription.created_at).getTime(),
            updatedAt: new Date(subscription.updated_at).getTime(),
          }
        : null,
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
    set({ session: null, user: null, profile: null, subscription: null })
  },
}))
