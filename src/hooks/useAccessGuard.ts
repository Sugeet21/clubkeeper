import { useAuthStore } from '../store/authStore'

type GuardResult =
  | { canAccess: false; reason: 'loading' | 'db_loading' | 'not_authenticated' | 'needs_subscription' | 'trial_ended' | 'subscription_ended' }
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
  if (!sub || sub.status === 'none') return { canAccess: false, reason: 'needs_subscription' }
  if (sub.status === 'expired' || sub.status === 'cancelled') {
    return { canAccess: false, reason: 'subscription_ended' }
  }

  if (sub.status === 'trialing') {
    if (sub.trialEndsAt && sub.trialEndsAt < Date.now()) {
      return { canAccess: false, reason: 'trial_ended' }
    }
    return {
      canAccess: true,
      isTrialing: true,
      daysLeftInTrial: Math.ceil((sub.trialEndsAt! - Date.now()) / 86400000),
    }
  }

  if (sub.status === 'past_due') return { canAccess: true, isPastDue: true }

  return { canAccess: true }
}
