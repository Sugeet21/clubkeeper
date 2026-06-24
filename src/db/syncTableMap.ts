// Phase C — single source of truth for the snake_case ↔ camelCase mapping.
//
// The OUTBOX stores Supabase table names (snake_case) because the SyncRunner
// in Chunk 4 passes that string directly to `supabase.from(table).upsert(...)`.
// The DEXIE tables on this device are camelCase because that's how
// ClubKeeperDB's fields are declared in src/db/database.ts.
//
// Every wrapper (Chunk 3), the runner (Chunk 4), and the reader (Chunk 5) go
// through these mappers. Nothing in this project should hand-roll the
// conversion — the union literal types catch typos at compile time.

import type { SyncTableName } from '../types'

/** Dexie table names — exactly the keys on ClubKeeperDB that are synced. */
export type DexieSyncTableName =
  | 'gameTables'
  | 'sessions'
  | 'sessionItems'
  | 'canteenItems'
  | 'customers'
  | 'walletTransactions'
  | 'canteenSales'
  | 'stockPurchases'
  | 'bookings'

const SYNC_TO_DEXIE: Record<SyncTableName, DexieSyncTableName> = {
  game_tables:          'gameTables',
  sessions:             'sessions',
  session_items:        'sessionItems',
  canteen_items:        'canteenItems',
  customers:            'customers',
  wallet_transactions:  'walletTransactions',
  canteen_sales:        'canteenSales',
  stock_purchases:      'stockPurchases',
  bookings:             'bookings',
}

const DEXIE_TO_SYNC: Record<DexieSyncTableName, SyncTableName> = {
  gameTables:         'game_tables',
  sessions:           'sessions',
  sessionItems:       'session_items',
  canteenItems:       'canteen_items',
  customers:          'customers',
  walletTransactions: 'wallet_transactions',
  canteenSales:       'canteen_sales',
  stockPurchases:     'stock_purchases',
  bookings:           'bookings',
}

export function dexieTableFor(t: SyncTableName): DexieSyncTableName {
  return SYNC_TO_DEXIE[t]
}

export function syncTableFor(t: DexieSyncTableName): SyncTableName {
  return DEXIE_TO_SYNC[t]
}

/** All 9 SyncTableNames in dependency-safe order for the initial pull (§7.1).
 *  Catalog first (no FKs to other synced tables), then operational. */
export const SYNC_TABLES_PULL_ORDER: SyncTableName[] = [
  'game_tables',
  'canteen_items',
  'customers',
  'sessions',
  'session_items',
  'canteen_sales',
  'wallet_transactions',
  'stock_purchases',
  'bookings',
]
