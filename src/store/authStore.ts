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
  initialize: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  subscription: null,
  loading: true,

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    set({ session, user: session?.user ?? null })

    if (session?.user) {
      await get().refreshProfile()
    }

    set({ loading: false })

    supabase.auth.onAuthStateChange(async (_event, session) => {
      set({ session, user: session?.user ?? null })
      if (session?.user) {
        await get().refreshProfile()
      } else {
        set({ profile: null, subscription: null })
      }
    })
  },

  refreshProfile: async () => {
    const user = get().user
    if (!user) return

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
      },
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null, profile: null, subscription: null })
  },
}))
