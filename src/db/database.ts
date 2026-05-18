import Dexie, { type Table } from 'dexie'
import type { GameTable, Session, ClubSettings } from '../types'

class ClubKeeperDB extends Dexie {
  gameTables!: Table<GameTable, number>
  sessions!: Table<Session, number>
  settings!: Table<ClubSettings, number>

  constructor() {
    super('ClubKeeperDB')
    // Version 1 kept for upgrade path (no migration callback needed)
    this.version(1).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
    })
    // Version 2: adds optional roundedDurationMs field to sessions (no index change)
    this.version(2).stores({
      gameTables: '++id, name, gameType, sortOrder, outOfService',
      sessions: '++id, tableId, status, startedAt, endedAt',
      settings: 'id',
    })
  }
}

export const db = new ClubKeeperDB()
