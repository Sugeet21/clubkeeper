import { useAuthStore } from '../store/authStore'

type GuardResult =
  | { canAccess: false; reason: 'loading' | 'db_loading' | 'not_authenticated' | 'no_subscription' | 'trial_expired' | 'subscription_ended' }
  | { canAccess: true; isTrialing?: boolean; daysLeftInTrial?: number; isPastDue?: boolean }

export function useAccessGuard(): GuardResult {
  const { session, subscription, loading, dbReady } = useAuthStore()

  if (loading) return { canAccess: false, reason: 'loading' }
  if (!session) return { canAccess: false, reason: 'not_authenticated' }

  // User is authenticated but per-user IndexedDB is not open yet.
  // This is a brief window between auth resolving and initDbForUser completing.
  // Show the same spinner — do NOT let pages run Dexie queries against the
  // placeholder DB (Pattern D6).
  if (!dbReady) return { canAccess: false, reason: 'db_loading' }

  const sub = subscription
  if (!sub || sub.status === 'none' || sub.status === 'cancelled' || sub.status === 'expired') {
    return { canAccess: false, reason: 'no_subscription' }
  }

  if (sub.status === 'trialing') {
    if (sub.trialEndsAt && sub.trialEndsAt < Date.now()) {
      return { canAccess: false, reason: 'trial_expired' }
    }
    return {
      canAccess: true,
      isTrialing: true,
      daysLeftInTrial: sub.trialEndsAt
        ? Math.ceil((sub.trialEndsAt - Date.now()) / 86400000)
        : 0,
    }
  }

  if (sub.status === 'past_due') return { canAccess: true, isPastDue: true }

  // status === 'active'
  return { canAccess: true }
}
