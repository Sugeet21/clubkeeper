// DEV-ONLY perf spike for #175 Chunk 0 insight rollups.
// Route: /__dev/test-rollup-perf (gated by import.meta.env.DEV — never in prod).
//
// Purpose (the Chunk 0 deliverable): PROVE a full re-derive stays fast on a low-end Android
// after months of data (#175 build constraint). It synthesizes representative raw data at a
// chosen scale, then times:
//   1. deriveRollups()  — the PURE core, no I/O (the real cost of the computation)
//   2. rebuildRollups() — the Dexie round-trip (clear + bulkPut into IndexedDB)
// and reports row counts + ms. Throwaway surface — NOT the feature. No insight display here.
//
// Run this on Sugeet's actual phone (the target device) to get real numbers, not laptop ones.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deriveRollups, rebuildRollups, type RollupSource } from '../../lib/rollups'
import { db } from '../../db/database'
import type { Session, SessionItem, CanteenSale, StockPurchase } from '../../types'

// Representative shape of a real small club, scaled by number of DAYS of history.
// Per day (rough, matches a ₹50k–₹5L/mo club): ~18 completed sessions across ~6 tables,
// ~40% of sessions have a canteen line, ~25 walk-in canteen sales, ~1 restock day in 4.
const SESSIONS_PER_DAY = 18
const TABLES = 6
const ITEMS = 50
const WALKINS_PER_DAY = 25

function synth(days: number): RollupSource {
  const sessions: Session[] = []
  const sessionItems: SessionItem[] = []
  const canteenSales: CanteenSale[] = []
  const stockPurchases: StockPurchase[] = []

  const DAY_MS = 86_400_000
  // Anchor deterministically off a fixed epoch so runs are comparable (no Math.random —
  // it's banned in workflow scripts and undesirable here for reproducibility). Vary by index.
  const base = 1_700_000_000_000 // fixed anchor (Nov 2023)

  let sIdx = 0
  const itemIds = Array.from({ length: ITEMS }, (_, i) => `item-${i.toString().padStart(3, '0')}`)

  for (let d = 0; d < days; d++) {
    const dayStart = base + d * DAY_MS
    for (let k = 0; k < SESSIONS_PER_DAY; k++) {
      const startedAt = dayStart + ((10 + (k % 12)) * 3_600_000) // spread across 10:00-21:00
      const playMs = (30 + ((sIdx * 7) % 90)) * 60_000 // 30-120 min
      const endedAt = startedAt + playMs
      const id = `sess-${sIdx}`
      sessions.push({
        id,
        tableId: `table-${sIdx % TABLES}`,
        startedAt,
        endedAt,
        pausedTotalMs: 0,
        pausedAt: null,
        billingMode: 'per_hour',
        rateSnapshot: 120,
        playerName: null,
        playerCount: 1,
        note: null,
        framesPlayed: null,
        status: 'completed',
        amount: 100 + ((sIdx * 13) % 400),
      })
      // ~40% of sessions carry a canteen line.
      if (sIdx % 5 < 2) {
        sessionItems.push({
          id: `si-${sIdx}`,
          sessionId: id,
          name: `Item ${sIdx % ITEMS}`,
          price: 20 + (sIdx % 30),
          quantity: 1 + (sIdx % 3),
          addedAt: startedAt + 600_000,
        })
      }
      sIdx++
    }
    // Walk-in canteen sales.
    for (let w = 0; w < WALKINS_PER_DAY; w++) {
      const createdAt = dayStart + ((9 + (w % 13)) * 3_600_000)
      const itemId = itemIds[(d + w) % ITEMS]
      canteenSales.push({
        id: `sale-${d}-${w}`,
        createdAt,
        items: [{ name: `Item ${(d + w) % ITEMS}`, price: 20 + (w % 30), quantity: 1 + (w % 4), canteenItemId: itemId }],
        subtotal: 40,
        paymentBreakdown: { cash: 40, upi: 0, wallet: 0 },
        total: 40,
      })
    }
    // Restock roughly every 4th day: a bulk-ish batch across ~10 items.
    if (d % 4 === 0) {
      for (let r = 0; r < 10; r++) {
        const itemId = itemIds[(d + r) % ITEMS]
        stockPurchases.push({
          id: `sp-${d}-${r}`,
          canteenItemId: itemId,
          quantityAdded: 10 + (r % 20),
          cost: r % 3 === 0 ? 0 : 100 + r * 5, // some cost-0 rows (bulk-entry-like)
          source: 'other',
          createdAt: dayStart + 3_600_000,
        })
      }
    }
  }
  return { sessions, sessionItems, canteenSales, stockPurchases }
}

interface Result {
  days: number
  rawRows: number
  rollupRows: number
  deriveMs: number
  rebuildMs: number
  cacheRows: number
}

export default function TestRollupPerf() {
  const navigate = useNavigate()
  const [days, setDays] = useState(180)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const src = synth(days)
      const rawRows =
        src.sessions.length + src.sessionItems.length + src.canteenSales.length + src.stockPurchases.length

      // 1) pure derive timing — the computation cost alone, no I/O.
      const t0 = performance.now()
      const rows = deriveRollups(src, 1_700_000_000_000)
      const deriveMs = performance.now() - t0

      // 2) Dexie round-trip: load synth into the raw tables, then rebuildRollups() (reads raw
      //    + clears/bulkPuts the cache). We seed the raw tables so rebuild exercises the real
      //    read path. This MUTATES local Dexie — DEV only; caller can wipe after.
      await db.transaction('rw', db.sessions, db.sessionItems, db.canteenSales, db.stockPurchases, async () => {
        await Promise.all([db.sessions.clear(), db.sessionItems.clear(), db.canteenSales.clear(), db.stockPurchases.clear()])
        await Promise.all([
          db.sessions.bulkPut(src.sessions),
          db.sessionItems.bulkPut(src.sessionItems),
          db.canteenSales.bulkPut(src.canteenSales),
          db.stockPurchases.bulkPut(src.stockPurchases),
        ])
      })
      const t1 = performance.now()
      const cacheRows = await rebuildRollups(1_700_000_000_000)
      const rebuildMs = performance.now() - t1

      setResult({ days, rawRows, rollupRows: rows.length, deriveMs, rebuildMs, cacheRows })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text p-4">
      <button onClick={() => navigate(-1)} className="text-text-dim text-sm min-h-[44px] mb-2">← Back</button>
      <h1 className="text-[16px] font-bold mb-1">Rollup perf spike (#175 Chunk 0)</h1>
      <p className="text-[12px] text-text-faint mb-4">
        DEV only. Synthesizes ~{SESSIONS_PER_DAY} sessions + {WALKINS_PER_DAY} walk-ins/day over N days,
        then times the pure derive and the Dexie rebuild. ⚠ Overwrites local sessions/sale/stock tables — sign out/in to restore real data.
      </p>

      <div className="flex items-center gap-2 mb-3">
        {[30, 90, 180, 365, 730].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={
              'px-3 min-h-[44px] rounded-xl text-[13px] font-semibold border ' +
              (days === d ? 'bg-accent text-bg border-accent' : 'bg-bg-card text-text-dim border-border')
            }
          >
            {d}d
          </button>
        ))}
      </div>

      <button
        onClick={() => void run()}
        disabled={busy}
        className="w-full min-h-[48px] rounded-xl bg-accent text-bg font-bold disabled:opacity-50 mb-4"
      >
        {busy ? 'Running…' : `Run ${days}-day spike`}
      </button>

      {error && <p className="text-busy text-sm mb-3">Error: {error}</p>}

      {result && (
        <div className="rounded-xl border border-border bg-bg-card p-4 text-[13px] font-mono space-y-1.5">
          <Row k="Days of history" v={`${result.days}`} />
          <Row k="Raw rows (in)" v={result.rawRows.toLocaleString('en-IN')} />
          <Row k="Rollup rows (out)" v={result.rollupRows.toLocaleString('en-IN')} />
          <Row k="Cache rows written" v={result.cacheRows.toLocaleString('en-IN')} />
          <div className="border-t border-border my-1" />
          <Row k="Pure derive" v={`${result.deriveMs.toFixed(1)} ms`} hot={result.deriveMs > 150} />
          <Row k="Dexie rebuild (full)" v={`${result.rebuildMs.toFixed(1)} ms`} hot={result.rebuildMs > 400} />
          <p className="text-[11px] text-text-faint pt-2 leading-snug">
            Target: on a low-end Android the full rebuild should be well under ~1s even at 730d, since it
            only runs as a fallback (Chunk 1 makes updates incremental). If it isn&apos;t, split stores or
            shrink the grain before building the display chunks.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-dim">{k}</span>
      <span className={hot ? 'text-busy font-bold' : 'text-text font-bold'}>{v}</span>
    </div>
  )
}
