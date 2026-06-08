import type { RateTier, Session, SessionItem } from '../types'

/**
 * Tier-based price lookup with tolerance.
 * Tiers MUST be sorted ascending by minutes (validation enforces this on write).
 *
 * Algorithm:
 *   billableMinutes = ceil(elapsedMs / 60000)
 *   for each tier ascending: if billableMinutes <= tier.minutes + tolerance → return tier.price
 *   beyond largest tier → extrapolate by last tier's per-minute rate
 */
export function priceForElapsed(
  elapsedMs: number,
  tiers: RateTier[],
  toleranceMinutes: number,
): number {
  const billableMinutes = Math.ceil(elapsedMs / 60000)
  for (const tier of tiers) {
    if (billableMinutes <= tier.minutes + toleranceMinutes) {
      return tier.price
    }
  }
  // Beyond largest tier — extrapolate by last tier's per-minute rate
  const lastTier = tiers[tiers.length - 1]
  const overflow = billableMinutes - lastTier.minutes
  const perMinute = lastTier.price / lastTier.minutes
  return Math.round(lastTier.price + overflow * perMinute)
}

export function calculateAmount(
  session: Session,
  elapsedMs: number,
  rounding?: 'none' | '15min' | '30min',
): number {
  if (session.billingMode === 'per_frame') {
    return (session.framesPlayed ?? 0) * session.rateSnapshot
  }
  // Rate card branch — rounding setting is ignored (tier + tolerance IS the rounding)
  if (session.rateCardSnapshot && session.rateCardSnapshot.length > 0) {
    const tol = session.toleranceMinutesSnapshot ?? 10
    return priceForElapsed(elapsedMs, session.rateCardSnapshot, tol)
  }
  // Legacy linear branch
  let effectiveMs = elapsedMs
  if (rounding === '15min') effectiveMs = Math.ceil(elapsedMs / 900000) * 900000
  else if (rounding === '30min') effectiveMs = Math.ceil(elapsedMs / 1800000) * 1800000
  const hours = effectiveMs / 3600000
  return Math.round(hours * session.rateSnapshot)
}

export function calculateItemsTotal(items: SessionItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0)
}

/** Round elapsed ms UP to the nearest bucket (15 or 30 minutes). */
export function applyRounding(
  elapsedMs: number,
  rounding: 'none' | '15min' | '30min',
): number {
  if (rounding === 'none') return elapsedMs
  const bucketMs = rounding === '15min' ? 15 * 60 * 1000 : 30 * 60 * 1000
  return Math.ceil(elapsedMs / bucketMs) * bucketMs
}
