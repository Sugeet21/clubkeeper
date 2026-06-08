import type { RateTier, Session, SessionItem } from '../types'

/**
 * Mode A — "minimum charge" model (traditional Indian club billing).
 * Rounds elapsed up to the nearest minute, then walks tiers.
 * If billableMinutes <= tier.minutes + tolerance → return tier.price (flat floor).
 * Beyond last tier → extrapolate at last tier's per-minute rate.
 * Tiers MUST be sorted ascending by minutes.
 */
export function priceForElapsedMinimum(
  elapsedMs: number,
  tiers: RateTier[],
  toleranceMinutes: number,
): number {
  if (elapsedMs <= 0 || tiers.length === 0) return 0
  const billableMinutes = Math.ceil(elapsedMs / 60000)
  for (const tier of tiers) {
    if (billableMinutes <= tier.minutes + toleranceMinutes) {
      return tier.price
    }
  }
  const lastTier = tiers[tiers.length - 1]
  const overflow = billableMinutes - lastTier.minutes
  const perMinute = lastTier.price / lastTier.minutes
  return Math.round(lastTier.price + overflow * perMinute)
}

/**
 * Mode B — "pro-rated" model (default for new tables).
 * Before tier 1: linear ramp from ₹0 → tier1.price.
 * At each tier: flat plateau from tier.minutes to tier.minutes + tolerance.
 * Between tiers: linear interpolation from end of plateau to next tier mark.
 * Beyond last tier + tolerance: extrapolate at last tier's per-minute rate.
 * Tiers MUST be sorted ascending by minutes.
 */
export function priceForElapsedProrated(
  elapsedMs: number,
  tiers: RateTier[],
  toleranceMinutes: number,
): number {
  const em = elapsedMs / 60000
  if (em <= 0 || tiers.length === 0) return 0

  const tier1 = tiers[0]

  // Pre-tier-1: linear ramp ₹0 → tier1.price
  if (em < tier1.minutes) {
    return Math.round((em / tier1.minutes) * tier1.price)
  }

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]

    // Plateau: t.minutes to t.minutes + tolerance (inclusive)
    if (em <= t.minutes + toleranceMinutes) {
      return t.price
    }

    // Pro-rate to next tier if it exists and we're before it
    if (i + 1 < tiers.length) {
      const tNext = tiers[i + 1]
      if (em < tNext.minutes) {
        const x0 = t.minutes + toleranceMinutes
        const y0 = t.price
        const x1 = tNext.minutes
        const y1 = tNext.price
        if (x1 <= x0) return tNext.price // safety: bad config, fall through
        const progress = (em - x0) / (x1 - x0)
        return Math.round(y0 + progress * (y1 - y0))
      }
    }
  }

  // Beyond last tier + tolerance: extrapolate at last tier's per-minute rate
  const last = tiers[tiers.length - 1]
  const perMin = last.price / last.minutes
  const overflow = em - (last.minutes + toleranceMinutes)
  return Math.round(last.price + Math.max(0, overflow) * perMin)
}

export function calculateAmount(
  session: Session,
  elapsedMs: number,
  rounding?: 'none' | '15min' | '30min',
): number {
  if (session.billingMode === 'per_frame') {
    return (session.framesPlayed ?? 0) * session.rateSnapshot
  }
  // Rate card branch — rounding setting is ignored (tier+tolerance IS the rounding)
  if (session.rateCardSnapshot && session.rateCardSnapshot.length > 0) {
    const tol = session.toleranceMinutesSnapshot ?? 10
    const mode = session.rateCardBillingSnapshot ?? 'prorated'
    return mode === 'minimum'
      ? priceForElapsedMinimum(elapsedMs, session.rateCardSnapshot, tol)
      : priceForElapsedProrated(elapsedMs, session.rateCardSnapshot, tol)
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
