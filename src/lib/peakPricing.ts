import type { CanteenItem, ClubSettings } from '../types'

export interface PeakConfig {
  enabled: boolean
  startHour: number
  startMinute: number
  endHour: number
  endMinute: number
}

const DEFAULTS = {
  startHour: 22,
  startMinute: 0,
  endHour: 6,
  endMinute: 0,
}

export function getPeakConfig(settings: ClubSettings | undefined): PeakConfig {
  return {
    enabled: settings?.peakPricingEnabled ?? false,
    startHour: settings?.peakStartHour ?? DEFAULTS.startHour,
    startMinute: settings?.peakStartMinute ?? DEFAULTS.startMinute,
    endHour: settings?.peakEndHour ?? DEFAULTS.endHour,
    endMinute: settings?.peakEndMinute ?? DEFAULTS.endMinute,
  }
}

// Equals-start: inside. Equals-end: outside. Cross-midnight aware.
export function isInPeakWindow(now: Date, cfg: PeakConfig): boolean {
  if (!cfg.enabled) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = cfg.startHour * 60 + cfg.startMinute
  const e = cfg.endHour * 60 + cfg.endMinute
  if (s === e) return false
  return s > e ? (cur >= s || cur < e) : (cur >= s && cur < e)
}

// Effective price for an item right now: peak price when peak active AND item has peakPrice; else regular.
export function getEffectivePrice(
  item: Pick<CanteenItem, 'defaultPrice' | 'peakPrice'>,
  now: Date,
  cfg: PeakConfig,
): number {
  if (isInPeakWindow(now, cfg) && typeof item.peakPrice === 'number' && item.peakPrice > 0) {
    return item.peakPrice
  }
  return item.defaultPrice
}

function format12(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const mm = m.toString().padStart(2, '0')
  return `${h12}:${mm} ${period}`
}

export function formatPeakWindow(cfg: PeakConfig): string {
  return `${format12(cfg.startHour, cfg.startMinute)} → ${format12(cfg.endHour, cfg.endMinute)}`
}

export function formatPeakEnd(cfg: PeakConfig): string {
  return format12(cfg.endHour, cfg.endMinute)
}
