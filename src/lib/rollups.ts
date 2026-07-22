// #175 Chunk 0 — insight rollup re-derive (PLUMBING ONLY: no display, no live-path writers).
//
// `deriveRollups()` is a PURE function: raw synced rows in → DailyRollup[] out. No Dexie,
// no clock, no I/O — so it's trivially testable and the perf spike can feed it synthetic
// data. `rebuildRollups()` is the thin Dexie wrapper (read raw → derive → replace the cache).
//
// The rollup cache is a DEVICE-LOCAL, WIPE-SAFE index over raw (see DailyRollup in types).
// Raw synced tables stay the source of truth; this never invents data. Chunk 1 will add
// incremental updates on the write paths; Chunks 2-5 read. Chunk 0 stops here on purpose.
//
// Day bucketing uses date-fns `format(ts,'yyyy-MM-dd')` in LOCAL time (IST for the club),
// matching Summary/History/Piggy so a rollup day === what the owner sees elsewhere.

import { format } from 'date-fns'
import { db } from '../db/database'
import type {
  DailyRollup,
  RollupKind,
  Session,
  SessionItem,
  CanteenSale,
  StockPurchase,
} from '../types'

/** Deterministic composite id so a rebuild UPSERTS the same row (no dup accumulation). */
export function rollupId(kind: RollupKind, day: string, entityId: string): string {
  return `${kind}|${day}|${entityId}`
}

/** Local-day key for a Unix-ms timestamp. Local tz on purpose — see file header. */
function dayKey(ts: number): string {
  return format(new Date(ts), 'yyyy-MM-dd')
}

/** Billed play duration for a completed session, in ms. Prefer the stored rounded value
 *  (what the owner was billed on) when present; else raw elapsed minus paused. Never < 0. */
function sessionPlayMs(s: Session): number {
  if (typeof s.roundedDurationMs === 'number' && s.roundedDurationMs > 0) {
    return s.roundedDurationMs
  }
  if (s.endedAt === null) return 0
  return Math.max(0, s.endedAt - s.startedAt - (s.pausedTotalMs ?? 0))
}

// Raw input to the pure derive. Caller passes already-loaded arrays (rebuildRollups reads
// them from Dexie; the perf spike synthesizes them). `!deletedAt` filtering is the CALLER's
// job — deriveRollups trusts what it's given (keeps it pure + lets the spike test tombstones).
export interface RollupSource {
  sessions: Session[]
  sessionItems: SessionItem[]
  canteenSales: CanteenSale[]
  stockPurchases: StockPurchase[]
}

// Small mutable accumulator keyed by rollup id, flushed to DailyRollup[] at the end.
type Acc = Map<string, DailyRollup>

// The numeric (accumulating) fields of DailyRollup. Non-numeric fields (id/kind/day/
// entityId/updatedAt) are set once when the row is created, never summed.
type NumericField = Exclude<keyof DailyRollup, 'id' | 'kind' | 'day' | 'entityId' | 'updatedAt'>

function bump(
  acc: Acc,
  kind: RollupKind,
  day: string,
  entityId: string,
  patch: Partial<Record<NumericField, number>>,
  now: number,
): void {
  const id = rollupId(kind, day, entityId)
  const cur = acc.get(id) ?? { id, kind, day, entityId, updatedAt: now }
  // Accumulate each numeric field via a typed key — no cast, treat undefined as 0.
  for (const key of Object.keys(patch) as NumericField[]) {
    const add = patch[key]
    if (typeof add === 'number') {
      cur[key] = (cur[key] ?? 0) + add
    }
  }
  cur.updatedAt = now
  acc.set(id, cur)
}

/**
 * Pure re-derive. `now` is passed in (never read from a clock) so results are deterministic
 * and the spike is reproducible. Returns every rollup row across all three kinds.
 *
 * Contract per kind:
 *   'item'  (day × canteenItemId): unitsSold/itemRevenue from table SessionItems + walk-in
 *           CanteenSale lines that carry a canteenItemId; unitsReceived/unitsReversed/receiptCost
 *           from StockPurchases (kind 'reversal' → reversed, else received; cost per row).
 *   'table' (day × tableId, keyed on the day the session ENDED): tableRevenue (session.amount),
 *           sessionCount (turns), playMs, sessionsWithCanteen (attach-rate numerator).
 *   'hour'  (weekday-hour bucket, entityId `${weekday}-${hour}`, rolled under the START day):
 *           hourSessionStarts + hourRevenue — for the utilization heatmap / dead hours.
 */
export function deriveRollups(src: RollupSource, now: number): DailyRollup[] {
  const acc: Acc = new Map()

  // Which sessions had ≥1 canteen line (for attach rate) — sessionId set.
  const sessionsWithCanteen = new Set<string>()
  for (const si of src.sessionItems) {
    if (si.sessionId) sessionsWithCanteen.add(si.sessionId)
  }

  // ── kind 'item' from table SessionItems ──
  // A SessionItem has no canteenItemId FK (it's a name/price snapshot), so item-level
  // canteen metrics from in-session sales key on NAME is unreliable across renames. For
  // Chunk 0 we roll in-session lines by name into a synthetic entityId `name:<lower>` so the
  // grain exists and is measured; Chunk 2 can reconcile to canteenItemId via canteenMatch if
  // the display needs true per-item joins. Walk-in CanteenSale lines DO carry canteenItemId.
  //
  // SPIKE FINDING (see #175 Chunk 0 report): keying in-session lines by NAME and walk-ins by
  // canteenItemId means those two never share a rollup row for the same product, so the 'item'
  // grain has HIGH cardinality (≈1 rollup row per raw row at 730d in the bench). Fine for the
  // rebuild cost proven here, but Chunk 2 should reconcile in-session lines to canteenItemId
  // (via canteenMatch) BEFORE display so "top items"/"days of cover" don't double-count a
  // product under both a name-key and an id-key. Not fixed in Chunk 0 — it's a display concern,
  // and doing it here would drag canteenMatch into the pure core.
  for (const si of src.sessionItems) {
    const day = dayKey(si.addedAt)
    const entity = `name:${si.name.trim().toLowerCase()}`
    bump(acc, 'item', day, entity, {
      unitsSold: si.quantity,
      itemRevenue: si.price * si.quantity,
    }, now)
  }

  // ── kind 'item' from walk-in CanteenSales ──
  for (const sale of src.canteenSales) {
    const day = dayKey(sale.createdAt)
    for (const line of sale.items) {
      const entity = line.canteenItemId ?? `name:${line.name.trim().toLowerCase()}`
      bump(acc, 'item', day, entity, {
        unitsSold: line.quantity,
        itemRevenue: line.price * line.quantity,
      }, now)
    }
  }

  // ── kind 'item' from StockPurchases (received / reversed) ──
  for (const sp of src.stockPurchases) {
    const day = dayKey(sp.createdAt)
    const isReversal = sp.kind === 'reversal'
    bump(acc, 'item', day, sp.canteenItemId, {
      unitsReceived: isReversal ? 0 : sp.quantityAdded,
      unitsReversed: isReversal ? sp.quantityAdded : 0,
      receiptCost: isReversal ? 0 : sp.cost, // cost-0 rows contribute 0 (see #176/#175 caveat)
    }, now)
  }

  // ── kind 'table' + 'hour' from completed sessions ──
  for (const s of src.sessions) {
    if (s.status !== 'completed' || s.endedAt === null) continue
    if (!s.id) continue
    const endDay = dayKey(s.endedAt)
    bump(acc, 'table', endDay, s.tableId, {
      tableRevenue: s.amount,
      sessionCount: 1,
      playMs: sessionPlayMs(s),
      sessionsWithCanteen: sessionsWithCanteen.has(s.id) ? 1 : 0,
    }, now)

    // Hour bucket keys on the START moment (when the table got occupied), rolled under the
    // start day so "peak hours" reflects when play begins.
    const start = new Date(s.startedAt)
    const weekday = start.getDay()   // 0=Sun .. 6=Sat (local)
    const hour = start.getHours()    // 0..23 (local)
    bump(acc, 'hour', dayKey(s.startedAt), `${weekday}-${hour}`, {
      hourSessionStarts: 1,
      hourRevenue: s.amount,
    }, now)
  }

  return [...acc.values()]
}

/**
 * Rebuild the ENTIRE rollup cache from raw Dexie tables (full re-derive). Wipe-safe: clears
 * the store and replaces it in one transaction, so a partial failure never leaves a half-built
 * cache readable. Filters tombstoned (`!deletedAt`) raw rows — the cache must reflect only live
 * data. `now` defaults to Date.now() at the boundary (kept out of the pure core).
 *
 * Chunk 0 exposes this for the perf spike + a future manual "rebuild" affordance. Chunk 1 adds
 * incremental maintenance so this full rebuild is only a fallback, not the hot path.
 *
 * CHUNK 1 TODO (reviewer-flagged): when the first READER of `rollups` lands, add
 * `db.rollups.clear()` to `resetEverything`'s transaction (src/db/queries.ts) so an owner
 * "Reset all data" can't surface stale insight numbers from a pre-reset cache. Safe to omit
 * in Chunk 0 (nothing reads the cache yet, and rebuild is wipe-safe) — same as restockDrafts.
 */
export async function rebuildRollups(now: number = Date.now()): Promise<number> {
  const [sessions, sessionItems, canteenSales, stockPurchases] = await Promise.all([
    db.sessions.filter((r) => !r.deletedAt).toArray(),
    db.sessionItems.filter((r) => !r.deletedAt).toArray(),
    db.canteenSales.filter((r) => !r.deletedAt).toArray(),
    db.stockPurchases.filter((r) => !r.deletedAt).toArray(),
  ])
  const rows = deriveRollups({ sessions, sessionItems, canteenSales, stockPurchases }, now)
  await db.transaction('rw', db.rollups, async () => {
    await db.rollups.clear()
    await db.rollups.bulkPut(rows)
  })
  return rows.length
}
