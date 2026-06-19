import type { Session, SessionItem, GameTable, CanteenSale } from '../types'

/**
 * Sentinel tableId for the synthetic "Walk-in Canteen" row injected into
 * `rankTables`. Real GameTable.id values are positive auto-increment ints,
 * so -1 cannot collide. Consumers (TopTablesList) detect this value and
 * render a "QS" pill instead of a medal/duration row.
 */
export const WALKIN_TABLE_ID = -1
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
  canteenSales: CanteenSale[] = [],
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
        : calculateAmount(s, getElapsedMs(s))
    const items = itemsBySessionId.get(s.id!) ?? []
    const itemsRevenue = calculateItemsTotal(items)
    buckets[hour].revenue += sessionRevenue + itemsRevenue
    buckets[hour].sessionCount += 1
  }

  // #93: walk-in canteen revenue contributes to the hour the sale was made.
  // No sessionCount bump — these are not table sessions.
  for (const sale of canteenSales) {
    const hour = new Date(sale.createdAt).getHours()
    buckets[hour].revenue += sale.total
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
  canteenSales: CanteenSale[] = [],
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
        : calculateAmount(s, getElapsedMs(s))
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

  const rows: TableSummary[] = [...byTable.entries()].map(([tableId, stats]) => ({
    tableId,
    tableName: tableNameMap.get(tableId) ?? `Table ${tableId}`,
    ...stats,
  }))

  // #93: synthesize a "Walk-in Canteen" row when walk-in revenue > 0.
  // No duration concept for walk-ins — totalDurationMs stays 0 (consumer skips
  // the avg-duration line on WALKIN_TABLE_ID).
  const walkInRevenue = canteenSales.reduce((sum, s) => sum + s.total, 0)
  if (walkInRevenue > 0) {
    rows.push({
      tableId: WALKIN_TABLE_ID,
      tableName: 'Walk-in Canteen',
      revenue: walkInRevenue,
      sessionCount: canteenSales.length,
      totalDurationMs: 0,
    })
  }

  return rows.sort((a, b) => b.revenue - a.revenue)
}

/**
 * Group session items by normalized name, sort by qty desc, return top N.
 */
export function topCanteenItems(
  items: SessionItem[],
  canteenSales: CanteenSale[],
  limit: number,
): CanteenItemSummary[] {
  const byName = new Map<string, CanteenItemSummary>()

  const addLine = (name: string, quantity: number, price: number) => {
    const key = normalizeName(name)
    if (!key) return
    const existing = byName.get(key)
    if (existing) {
      existing.qty += quantity
      existing.revenue += price * quantity
    } else {
      byName.set(key, {
        normalizedName: key,
        displayName: name,
        qty: quantity,
        revenue: price * quantity,
      })
    }
  }

  for (const item of items) addLine(item.name, item.quantity, item.price)
  // #93: walk-in canteen lines merge into the same name-keyed ranking. Field
  // names on CanteenSale.items match the (name, quantity, price) shape.
  for (const sale of canteenSales) {
    for (const line of sale.items) addLine(line.name, line.quantity, line.price)
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
        ? calculateAmount(s, getElapsedMs(s))
        : s.amount // past dates shouldn't have running sessions, but safe fallback

    tablesRevenue += sessionAmt

    const items = itemsBySessionId.get(s.id!) ?? []
    canteenRevenue += calculateItemsTotal(items)
  }

  return { tablesRevenue, canteenRevenue }
}
