import type { Session, SessionItem, GameTable } from '../types'
import { normalizeName } from './canteenMatch'
import { getElapsedMs } from './time'
import { calculateAmount, calculateItemsTotal } from './money'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface RevenueDelta {
  pct: number           // signed integer; 0 when flat
  direction: DeltaDirection
}

export interface HourlyBucket {
  hour: number          // 0-23
  revenue: number       // integer rupees
  sessionCount: number
}

export interface TableSummary {
  tableId: number
  tableName: string
  revenue: number
  sessionCount: number
  totalDurationMs: number
}

export interface CanteenItemSummary {
  normalizedName: string
  displayName: string
  qty: number
  revenue: number
}

// ─── Functions ─────────────────────────────────────────────────────────────────

/**
 * Compute signed % delta between current and baseline revenue.
 * Both inputs are integer rupees.
 */
export function computeDelta(current: number, baseline: number): RevenueDelta {
  if (current === 0 && baseline === 0) return { pct: 0, direction: 'flat' }
  if (baseline === 0) return { pct: 100, direction: 'up' }
  const pct = Math.round(((current - baseline) / baseline) * 100)
  if (pct === 0) return { pct: 0, direction: 'flat' }
  return { pct, direction: pct > 0 ? 'up' : 'down' }
}

/**
 * Bucket sessions + their items by the hour of the session's startedAt (local time).
 * Returns all 24 buckets (most zero), plus peakHour index (-1 if all zero).
 */
export function bucketByHour(
  sessions: Session[],
  itemsBySessionId: Map<number, SessionItem[]>,
): { buckets: HourlyBucket[]; peakHour: number } {
  const buckets: HourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
    sessionCount: 0,
  }))

  for (const s of sessions) {
    const hour = new Date(s.startedAt).getHours()
    const sessionRevenue =
      s.status === 'completed'
        ? s.amount
        : calculateAmount(s.billingMode, getElapsedMs(s), s.rateSnapshot, s.framesPlayed)
    const items = itemsBySessionId.get(s.id!) ?? []
    const itemsRevenue = calculateItemsTotal(items)
    buckets[hour].revenue += sessionRevenue + itemsRevenue
    buckets[hour].sessionCount += 1
  }

  let peakHour = -1
  let peakRevenue = 0
  for (const b of buckets) {
    if (b.revenue > peakRevenue) {
      peakRevenue = b.revenue
      peakHour = b.hour
    }
  }

  return { buckets, peakHour }
}

/**
 * Rank tables by total revenue (session amount + attributed items) descending.
 * Empty input returns empty array.
 */
export function rankTables(
  sessions: Session[],
  itemsBySessionId: Map<number, SessionItem[]>,
  tables: GameTable[],
): TableSummary[] {
  const tableNameMap = new Map<number, string>()
  for (const t of tables) {
    if (t.id !== undefined) tableNameMap.set(t.id, t.name)
  }

  const byTable = new Map<
    number,
    { revenue: number; sessionCount: number; totalDurationMs: number }
  >()

  for (const s of sessions) {
    const sessionRevenue =
      s.status === 'completed'
        ? s.amount
        : calculateAmount(s.billingMode, getElapsedMs(s), s.rateSnapshot, s.framesPlayed)
    const items = itemsBySessionId.get(s.id!) ?? []
    const itemsRevenue = calculateItemsTotal(items)
    const elapsedMs = getElapsedMs(s)
    const existing = byTable.get(s.tableId) ?? { revenue: 0, sessionCount: 0, totalDurationMs: 0 }
    byTable.set(s.tableId, {
      revenue: existing.revenue + sessionRevenue + itemsRevenue,
      sessionCount: existing.sessionCount + 1,
      totalDurationMs: existing.totalDurationMs + elapsedMs,
    })
  }

  return [...byTable.entries()]
    .map(([tableId, stats]) => ({
      tableId,
      tableName: tableNameMap.get(tableId) ?? `Table ${tableId}`,
      ...stats,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

/**
 * Group session items by normalized name, sort by qty desc, return top N.
 */
export function topCanteenItems(
  items: SessionItem[],
  limit: number,
): CanteenItemSummary[] {
  const byName = new Map<string, CanteenItemSummary>()

  for (const item of items) {
    const key = normalizeName(item.name)
    if (!key) continue
    const existing = byName.get(key)
    if (existing) {
      existing.qty += item.quantity
      existing.revenue += item.price * item.quantity
    } else {
      byName.set(key, {
        normalizedName: key,
        displayName: item.name,
        qty: item.quantity,
        revenue: item.price * item.quantity,
      })
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit)
}

/**
 * Compute total revenue (completed + live) from a sessions+items dataset.
 * Completed sessions use stored amount. Running/paused use live calc.
 * Pass isToday=false to skip live calculation for past dates.
 */
export function computeTotalRevenue(
  sessions: Session[],
  itemsBySessionId: Map<number, SessionItem[]>,
  isViewedDateToday: boolean,
): { tablesRevenue: number; canteenRevenue: number } {
  let tablesRevenue = 0
  let canteenRevenue = 0

  for (const s of sessions) {
    const sessionAmt =
      s.status === 'completed'
        ? s.amount
        : isViewedDateToday
        ? calculateAmount(s.billingMode, getElapsedMs(s), s.rateSnapshot, s.framesPlayed)
        : s.amount // past dates shouldn't have running sessions, but safe fallback

    tablesRevenue += sessionAmt

    const items = itemsBySessionId.get(s.id!) ?? []
    canteenRevenue += calculateItemsTotal(items)
  }

  return { tablesRevenue, canteenRevenue }
}
