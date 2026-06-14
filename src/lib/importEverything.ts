import { db } from '../db/database'
import { CURRENT_SCHEMA_VERSION } from '../db/queries'
import type {
  GameTable,
  Session,
  ClubSettings,
  SessionItem,
  CanteenItem,
  CanteenSale,
  StockPurchase,
} from '../types'
import type { Customer } from '../types/customer'
import type { WalletTransaction } from '../types/walletTransaction'

export type ImportFailureReason =
  | 'parse_error'
  | 'not_clubkeeper_file'
  | 'legacy_incomplete_format'
  | 'schema_too_new'
  | 'active_sessions_present'
  | 'empty_file'
  | 'transaction_failed'

export interface ImportSuccess {
  ok: true
  counts: {
    tables: number
    sessions: number
    sessionItems: number
    customers: number
    walletTxs: number
    canteenItems: number
    canteenSales: number
    stockPurchases: number
  }
  walletBalanceTotal: number
}

export interface ImportFailure {
  ok: false
  reason: ImportFailureReason
  detail?: string
}

export type ImportResult = ImportSuccess | ImportFailure

interface BackupShape {
  schemaVersion: unknown
  exportedAt?: unknown
  tables?: unknown
  sessions?: unknown
  sessionItems?: unknown
  settings?: unknown
  customers?: unknown
  walletTransactions?: unknown
  canteenItems?: unknown
  canteenSales?: unknown
  stockPurchases?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('FileReader returned non-string result'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsText(file)
  })
}

export async function importEverythingFromFile(file: File): Promise<ImportResult> {
  // 1. Read file text
  let text: string
  try {
    text = await readFileAsText(file)
  } catch (err) {
    return { ok: false, reason: 'parse_error', detail: String(err) }
  }

  if (!text || text.trim().length === 0) {
    return { ok: false, reason: 'empty_file' }
  }

  // 2. Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, reason: 'parse_error', detail: String(err) }
  }

  if (!isObject(parsed)) {
    return { ok: false, reason: 'not_clubkeeper_file', detail: 'Top-level JSON is not an object' }
  }

  const candidate = parsed as BackupShape

  // 3. Detect legacy 3-table format (no schemaVersion, only tables/sessions/settings)
  const hasSchemaVersion = typeof candidate.schemaVersion === 'number'
  const looksLike3TableLegacy =
    !hasSchemaVersion &&
    Array.isArray(candidate.tables) &&
    Array.isArray(candidate.sessions) &&
    'settings' in candidate
  if (looksLike3TableLegacy) {
    return { ok: false, reason: 'legacy_incomplete_format' }
  }

  // 4. Validate shape — all required keys + types
  if (!hasSchemaVersion) {
    return { ok: false, reason: 'not_clubkeeper_file', detail: 'Missing schemaVersion' }
  }

  const schemaVersion = candidate.schemaVersion as number
  if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) {
    return { ok: false, reason: 'not_clubkeeper_file', detail: 'Invalid schemaVersion' }
  }

  if (typeof candidate.exportedAt !== 'number' || !Number.isFinite(candidate.exportedAt)) {
    return { ok: false, reason: 'not_clubkeeper_file', detail: 'Missing or invalid exportedAt' }
  }

  const requiredArrayKeys: Array<keyof BackupShape> = [
    'tables',
    'sessions',
    'sessionItems',
    'customers',
    'walletTransactions',
    'canteenItems',
    'canteenSales',
    'stockPurchases',
  ]
  for (const key of requiredArrayKeys) {
    if (!Array.isArray(candidate[key])) {
      return { ok: false, reason: 'not_clubkeeper_file', detail: `Missing or non-array field: ${key}` }
    }
  }
  if (!('settings' in candidate)) {
    return { ok: false, reason: 'not_clubkeeper_file', detail: 'Missing settings field' }
  }

  // 5. Schema version gate
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, reason: 'schema_too_new', detail: `File schemaVersion=${schemaVersion}, app supports ${CURRENT_SCHEMA_VERSION}` }
  }

  // Coerce to typed arrays now that shape is validated
  const tables = candidate.tables as GameTable[]
  const sessions = candidate.sessions as Session[]
  const sessionItems = candidate.sessionItems as SessionItem[]
  const settings = candidate.settings as ClubSettings | undefined
  const customers = candidate.customers as Customer[]
  const walletTransactions = candidate.walletTransactions as WalletTransaction[]
  const canteenItems = candidate.canteenItems as CanteenItem[]
  const canteenSales = candidate.canteenSales as CanteenSale[]
  const stockPurchases = candidate.stockPurchases as StockPurchase[]

  // 6. Pre-check: refuse if any active session in CURRENT DB
  try {
    const activeCount = await db.sessions
      .where('status')
      .anyOf(['running', 'paused'])
      .count()
    if (activeCount > 0) {
      return { ok: false, reason: 'active_sessions_present' }
    }
  } catch (err) {
    return { ok: false, reason: 'transaction_failed', detail: `Active-session pre-check failed: ${String(err)}` }
  }

  // 7. Single atomic transaction across ALL stores: clear + bulkAdd
  try {
    await db.transaction(
      'rw',
      [
        db.gameTables,
        db.sessions,
        db.sessionItems,
        db.settings,
        db.customers,
        db.walletTransactions,
        db.canteenItems,
        db.canteenSales,
        db.stockPurchases,
      ],
      async () => {
        await Promise.all([
          db.gameTables.clear(),
          db.sessions.clear(),
          db.sessionItems.clear(),
          db.settings.clear(),
          db.customers.clear(),
          db.walletTransactions.clear(),
          db.canteenItems.clear(),
          db.canteenSales.clear(),
          db.stockPurchases.clear(),
        ])

        // Bulk-insert each store. bulkAdd preserves ids verbatim — critical for FK links.
        if (tables.length) await db.gameTables.bulkAdd(tables)
        if (sessions.length) await db.sessions.bulkAdd(sessions)
        if (sessionItems.length) await db.sessionItems.bulkAdd(sessionItems)
        if (settings) await db.settings.add(settings)
        if (customers.length) await db.customers.bulkAdd(customers)
        if (walletTransactions.length) await db.walletTransactions.bulkAdd(walletTransactions)
        if (canteenItems.length) await db.canteenItems.bulkAdd(canteenItems)
        if (canteenSales.length) await db.canteenSales.bulkAdd(canteenSales)
        if (stockPurchases.length) await db.stockPurchases.bulkAdd(stockPurchases)
      },
    )
  } catch (err) {
    // Single-tx rollback: Dexie auto-rolls back any partial writes
    return { ok: false, reason: 'transaction_failed', detail: String(err) }
  }

  // 8. Post-import: compute counts + wallet balance total
  const walletBalanceTotal = customers.reduce(
    (sum, c) => sum + (typeof c.walletBalance === 'number' ? c.walletBalance : 0),
    0,
  )

  // Settings.userId mismatch warning (does not block import)
  if (settings && typeof (settings as ClubSettings & { userId?: unknown }).userId === 'string') {
    // Field doesn't exist on ClubSettings today, but if a future version adds it,
    // log a warn when the imported user differs from the current session user.
    console.warn('[importEverything] imported settings includes a userId field — verify ownership')
  }

  return {
    ok: true,
    counts: {
      tables: tables.length,
      sessions: sessions.length,
      sessionItems: sessionItems.length,
      customers: customers.length,
      walletTxs: walletTransactions.length,
      canteenItems: canteenItems.length,
      canteenSales: canteenSales.length,
      stockPurchases: stockPurchases.length,
    },
    walletBalanceTotal,
  }
}
