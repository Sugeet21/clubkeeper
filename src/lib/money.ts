import type { BillingMode } from '../types'

export function calculateAmount(
  billingMode: BillingMode,
  elapsedMs: number,
  rateSnapshot: number,
  framesPlayed: number | null,
): number {
  if (billingMode === 'per_frame') {
    return (framesPlayed ?? 0) * rateSnapshot
  }
  const hours = elapsedMs / (1000 * 60 * 60)
  return Math.round(hours * rateSnapshot)
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
