import { db } from './database'
import type { GameTable, ClubSettings } from '../types'

const SAMPLE_TABLES: Omit<GameTable, 'id'>[] = [
  {
    name: 'Pool 1',
    gameType: 'pool',
    ratePerHour: 120,
    outOfService: false,
    createdAt: Date.now(),
    sortOrder: 1,
    rateCard: [
      { minutes: 30, price: 70 },
      { minutes: 60, price: 100 },
      { minutes: 90, price: 170 },
      { minutes: 120, price: 200 },
      { minutes: 150, price: 270 },
      { minutes: 180, price: 300 },
    ],
    toleranceMinutes: 10,
    rateCardBilling: 'prorated',
  },
  {
    name: 'Pool 2',
    gameType: 'pool',
    ratePerHour: 120,
    outOfService: false,
    createdAt: Date.now(),
    sortOrder: 2,
  },
  {
    name: 'Snooker 1',
    gameType: 'snooker',
    ratePerHour: 150,
    ratePerFrame: 80,
    outOfService: false,
    createdAt: Date.now(),
    sortOrder: 3,
  },
  {
    name: 'Carrom 1',
    gameType: 'carrom',
    ratePerHour: 60,
    outOfService: false,
    createdAt: Date.now(),
    sortOrder: 4,
  },
  {
    name: 'Carrom 2',
    gameType: 'carrom',
    ratePerHour: 60,
    outOfService: false,
    createdAt: Date.now(),
    sortOrder: 5,
  },
]

const DEFAULT_SETTINGS: ClubSettings = {
  id: 1,
  clubName: 'My Club',
  currency: '₹',
  rounding: 'none',
  lowStockThreshold: 5,
  // v19: per-slot advance default. Operating hours stay undefined so the owner
  // must explicitly set Opens/Closes before Accept Bookings can be enabled (#106).
  bookingAdvancePerSlot: 50,
}

export async function seedIfEmpty(): Promise<void> {
  const [tableCount, settingsCount] = await Promise.all([
    db.gameTables.count(),
    db.settings.count(),
  ])

  const ops: Promise<unknown>[] = []

  if (tableCount === 0) {
    // Pre-assign UUIDs so seed rows work on both v19 (++id accepts caller-supplied id)
    // and v20 (plain id schema requires caller to supply id — no auto-generation).
    const tablesWithIds = SAMPLE_TABLES.map(t => ({ ...t, id: crypto.randomUUID() }))
    ops.push(db.gameTables.bulkAdd(tablesWithIds))
  }

  if (settingsCount === 0) {
    ops.push(db.settings.add(DEFAULT_SETTINGS))
  }

  if (ops.length > 0) {
    await Promise.all(ops)
  }
}
