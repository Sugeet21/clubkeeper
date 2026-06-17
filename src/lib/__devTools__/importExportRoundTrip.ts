/**
 * DEV-only round-trip self-test for Export ↔ Import.
 *
 * Run from the browser console: `runImportExportRoundTrip()`
 *
 * What it does:
 *   1. Snapshots row counts + wallet balance + piggy across all 9 stores.
 *   2. Calls getAllDataForExport() and serialises to a JSON blob.
 *   3. Wraps that blob as a File and runs importEverythingFromFile() on it.
 *   4. Re-snapshots and asserts every count matches.
 *
 * DESTRUCTIVE: This wipes and restores the current Dexie database. The wipe is
 * the whole point — we're proving that export → restore is lossless. Only run
 * on a non-production account.
 *
 * Module is mounted on `window.runImportExportRoundTrip` ONLY when
 * `import.meta.env.DEV === true` (see src/main.tsx).
 */

import { db } from '../../db/database'
import { getAllDataForExport, getPiggyBalance } from '../../db/queries'
import { importEverythingFromFile } from '../importEverything'

interface Snapshot {
  tables: number
  sessions: number
  sessionItems: number
  settings: number
  customers: number
  walletTransactions: number
  canteenItems: number
  canteenSales: number
  stockPurchases: number
  bookings: number
  walletBalanceTotal: number
  piggyCurrent: number
}

async function takeSnapshot(): Promise<Snapshot> {
  const [
    tables,
    sessions,
    sessionItems,
    settingsRow,
    customers,
    walletTransactions,
    canteenItems,
    canteenSales,
    stockPurchases,
    bookings,
    piggy,
  ] = await Promise.all([
    db.gameTables.count(),
    db.sessions.count(),
    db.sessionItems.count(),
    db.settings.get(1),
    db.customers.toArray(),
    db.walletTransactions.count(),
    db.canteenItems.count(),
    db.canteenSales.count(),
    db.stockPurchases.count(),
    db.bookings.count(),
    getPiggyBalance(),
  ])
  const walletBalanceTotal = customers.reduce(
    (sum, c) => sum + (typeof c.walletBalance === 'number' ? c.walletBalance : 0),
    0,
  )
  return {
    tables,
    sessions,
    sessionItems,
    settings: settingsRow ? 1 : 0,
    customers: customers.length,
    walletTransactions,
    canteenItems,
    canteenSales,
    stockPurchases,
    bookings,
    walletBalanceTotal,
    piggyCurrent: piggy.current,
  }
}

type SnapKey = keyof Snapshot

const ALL_KEYS: SnapKey[] = [
  'tables',
  'sessions',
  'sessionItems',
  'settings',
  'customers',
  'walletTransactions',
  'canteenItems',
  'canteenSales',
  'stockPurchases',
  'bookings',
  'walletBalanceTotal',
  'piggyCurrent',
]

export interface RoundTripResult {
  ok: boolean
  before: Snapshot
  after: Snapshot
  mismatches: Array<{ key: SnapKey; before: number; after: number }>
}

export async function runImportExportRoundTrip(): Promise<RoundTripResult> {
  // Refuse to run if any session is active — same guard as the production importer.
  const activeCount = await db.sessions
    .where('status')
    .anyOf(['running', 'paused'])
    .count()
  if (activeCount > 0) {
    console.error(
      '%c[round-trip] aborted: %d active session(s). Stop them before testing.',
      'color:#f55',
      activeCount,
    )
    throw new Error(`round-trip aborted: ${activeCount} active session(s)`)
  }

  console.log('%c[round-trip] taking before-snapshot…', 'color:#888')
  const before = await takeSnapshot()
  console.log('%c[round-trip] BEFORE', 'color:#888', before)

  console.log('%c[round-trip] exporting…', 'color:#888')
  const exported = await getAllDataForExport()
  const json = JSON.stringify(exported)
  const file = new File([json], 'round-trip-test.json', { type: 'application/json' })

  console.log(
    '%c[round-trip] running import (this wipes + restores the current Dexie DB)…',
    'color:#fa0',
  )
  const result = await importEverythingFromFile(file)
  if (!result.ok) {
    console.error('%c[round-trip] FAIL — import returned error:', 'color:#f55', result)
    throw new Error(`import failed: ${result.reason}`)
  }

  console.log('%c[round-trip] taking after-snapshot…', 'color:#888')
  const after = await takeSnapshot()
  console.log('%c[round-trip] AFTER', 'color:#888', after)

  const mismatches: RoundTripResult['mismatches'] = []
  for (const key of ALL_KEYS) {
    if (before[key] !== after[key]) {
      mismatches.push({ key, before: before[key], after: after[key] })
    }
    console.assert(
      before[key] === after[key],
      `[round-trip] mismatch on ${key}: before=${before[key]} after=${after[key]}`,
    )
  }

  const ok = mismatches.length === 0
  if (ok) {
    console.log(
      '%c[round-trip] PASS — export ↔ import is lossless across all 12 measures.',
      'color:#4f4;font-weight:bold',
    )
  } else {
    console.error('%c[round-trip] FAIL — mismatches:', 'color:#f55;font-weight:bold', mismatches)
  }

  return { ok, before, after, mismatches }
}
