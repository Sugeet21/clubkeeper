# Data Model

## Database: ClubKeeperDB (Dexie / IndexedDB)

### Schema Version 2 (current, after Prompt 7)

```ts
this.version(2).stores({
  tables: '++id, name, gameType, sortOrder, outOfService',
  sessions: '++id, tableId, status, startedAt, endedAt',
  settings: 'id',
});
```

### Tables Store

```ts
interface GameTable {
  id?: number;              // auto-incremented
  name: string;             // "Pool 1" — max 30 chars, alphanumeric+spaces+.-_
  gameType: 'pool' | 'snooker' | 'carrom' | 'playstation' | 'other';
  ratePerHour: number;      // rupees, integer, 1-99999
  ratePerFrame?: number;    // optional, used only for snooker per-frame
  outOfService: boolean;    // true = soft-deleted (hidden from Home)
  createdAt: number;        // Date.now() at creation
  sortOrder: number;        // for ordering in UI, increment by 1
}
```

### Sessions Store

```ts
interface Session {
  id?: number;
  tableId: number;
  startedAt: number;        // Unix ms — NEVER mutated except via editStartTime
  endedAt: number | null;   // null while running/paused
  pausedTotalMs: number;    // accumulated paused time
  pausedAt: number | null;  // Date.now() of current pause, null if not paused
  billingMode: 'per_hour' | 'per_frame';
  rateSnapshot: number;     // rate captured at session start — doesn't change if table rate edited
  playerName: string | null;// max 50 chars
  playerCount: number;      // 1-20
  note: string | null;      // max 200 chars
  framesPlayed: number | null;  // only for per_frame
  status: 'running' | 'paused' | 'completed';
  amount: number;           // calculated when stopped (integer rupees)
  roundedDurationMs?: number; // NEW in v2: stores rounded duration if rounding applied
}
```

### Settings Store (Singleton)

```ts
interface ClubSettings {
  id: 1;                    // always 1
  clubName: string;
  currency: '₹';            // locked for v1
  rounding: 'none' | '15min' | '30min';
}
```

## Indexes Explained

- `tables`: `++id` (primary auto), `name`, `gameType`, `sortOrder`, `outOfService` — all queryable
- `sessions`: `++id`, `tableId` (find active session per table), `status` (filter by running/paused/completed), `startedAt` (date range queries), `endedAt`
- `settings`: just `id` because there's only ever one row

## Critical Invariants

These MUST hold at all times. If a change could break them, push back to Sugeet.

1. **Only ONE active session per table at any time.**
   - "Active" = status === 'running' OR 'paused'
   - Enforced in `startSession()` via pre-check
   - Race condition guarded by re-check on submit

2. **`startedAt` is immutable except via `editSessionStart()`.**
   - It's the audit trail. Never overwrite during normal flow.

3. **`pausedTotalMs` only grows, never decreases.**
   - On resume: `pausedTotalMs += (Date.now() - pausedAt)`, then `pausedAt = null`

4. **`amount` is set ONCE at stopSession.**
   - For running/paused sessions, calculate on-the-fly via `calculateAmount()` for display, but don't write to DB.

5. **`rateSnapshot` is taken at session start and never changes.**
   - If owner edits table's `ratePerHour` later, in-progress sessions keep their original rate. Only new sessions use the new rate.

6. **`outOfService:true` tables stay editable but don't accept new sessions.**
   - This is soft delete. Past sessions reference the table_id which still exists.

7. **Cannot disable a table with an active session.** (Added in Prompt 8.)

## Time Math

All time-related math is centralized in `src/lib/time.ts`. Never reimplement.

```ts
function getElapsedMs(session: Session): number {
  let elapsed: number;
  if (session.status === 'completed') {
    elapsed = (session.endedAt! - session.startedAt) - session.pausedTotalMs;
  } else if (session.status === 'paused') {
    elapsed = (session.pausedAt! - session.startedAt) - session.pausedTotalMs;
  } else {
    elapsed = (Date.now() - session.startedAt) - session.pausedTotalMs;
  }
  return Math.max(0, elapsed); // clock skew guard
}
```

## Money Math

In `src/lib/money.ts`:

```ts
function calculateAmount(session: Session, elapsedMs: number, rounding?: 'none'|'15min'|'30min'): number {
  if (session.billingMode === 'per_frame') {
    return (session.framesPlayed ?? 0) * session.rateSnapshot;
  }
  
  let effectiveMs = elapsedMs;
  if (rounding === '15min') {
    effectiveMs = Math.ceil(elapsedMs / 900000) * 900000; // round UP to nearest 15min
  } else if (rounding === '30min') {
    effectiveMs = Math.ceil(elapsedMs / 1800000) * 1800000;
  }
  
  const hours = effectiveMs / 3600000;
  return Math.round(hours * session.rateSnapshot);
}
```

**Rounding only applies in `stopSession()`** — not during display while running (would be confusing if amount jumps every 15min).

## Migration Strategy

When schema needs to change:

1. Bump Dexie version: `this.version(3).stores({...})`
2. Add `.upgrade(tx => { ... })` if data needs transformation
3. Existing users open the app → Dexie auto-migrates on first load
4. Test by clearing IndexedDB and reseeding, also by upgrading from old schema

Example for v2 migration (already applied):
```ts
this.version(2).stores({
  tables: '++id, name, gameType, sortOrder, outOfService',
  sessions: '++id, tableId, status, startedAt, endedAt',
  settings: 'id',
}).upgrade(tx => {
  // Add roundedDurationMs field to existing sessions (optional, defaults undefined)
  // No actual data change needed — TypeScript optional means it's safe
});
```

## Data Export Format

When exporting for backup (Settings → Export All Data):

```json
{
  "version": 2,
  "exportedAt": 1716123456789,
  "clubName": "My Club",
  "tables": [...],
  "sessions": [...],
  "settings": {...}
}
```

Future: implement Import that reads this format and restores data.

## Query Patterns

All queries in `src/db/queries.ts`. Common patterns:

```ts
// Get all active sessions
await db.sessions.where('status').notEqual('completed').toArray();

// Get sessions in date range
await db.sessions
  .where('startedAt')
  .between(startOfDay.getTime(), endOfDay.getTime())
  .toArray();

// Get active session for a specific table
await db.sessions
  .where('tableId').equals(tableId)
  .and(s => s.status !== 'completed')
  .first();
```

## When to Add Cloud Sync

NOT YET. Triggers for adding cloud:
- 3+ paying customers ask for multi-device access
- Customer reports lost data and refuses to use it again
- Need for analytics across customers

Until then: offline-only is a feature, not a bug. No latency, works on bad WiFi.
