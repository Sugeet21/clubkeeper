// Phase C Chunk 5.2b — manual runtime-proof page for the SyncReader.
//
// DEV-only route mounted at /__dev/test-sync-reader (guarded in App.tsx by
// import.meta.env.DEV), mirroring the TestOutbox precedent. Purpose: make
// the mapper TRANSFORM runtime proof (SKILL.md Pending contract) one tap —
// seed rows in Supabase, then here: reset cursors → force pull → dump the
// resulting Dexie row shapes for pasting into the verification record.
//
// The dump is the assertion surface. For each pulled row confirm:
//   • *At fields (createdAt / updatedAt / deletedAt / addedAt / startedAt)
//     are NUMBERS (epoch ms) — never ISO strings
//   • no raw `updated_at` / `deleted_at` snake_case keys on the row
//   • nested structures (items, paymentBreakdown, tableMoves, rateCard)
//     are real arrays/objects — never JSON strings

import { useState } from 'react'
import { db } from '../../db/database'
import { syncReader } from '../../db/syncReader'
import { resetPullCursors } from '../../db/syncPullCursors'
import { dexieTableFor, SYNC_TABLES_PULL_ORDER } from '../../db/syncTableMap'

interface LogEntry {
  ts: string
  label: string
  ok: boolean
  detail: unknown
}

const DUMP_LIMIT = 3

export default function TestSyncReader() {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const log = (label: string, ok: boolean, detail: unknown) => {
    setLogs((prev) => [
      { ts: new Date().toISOString().slice(11, 23), label, ok, detail },
      ...prev,
    ])
  }

  // Wipe the per-table cursors so the next pull starts from epoch and
  // re-fetches every server row (bulkPut is idempotent — safe).
  const resetCursors = async () => {
    try {
      await resetPullCursors()
      log('resetCursors', true, 'pullCursors cleared — next pull starts from epoch')
    } catch (e) {
      log('resetCursors', false, String(e))
    }
  }

  // stop() + start() through the public lifecycle — start() kicks a fresh
  // initialPull (and re-subscribes the 4 realtime channels). Watch the
  // console for [syncReader] logs; then hit "Dump synced tables".
  const forcePull = () => {
    try {
      syncReader.stop()
      syncReader.start()
      log('forcePull', true, 'reader restarted — watch console for [syncReader] pull logs')
    } catch (e) {
      log('forcePull', false, String(e))
    }
  }

  // ── Chunk 5.3 LWW conflict-proof helpers ──────────────────────────────
  // Flow (SQL runs in the Supabase SQL editor; watch console for
  // [syncReader] realtime lines):
  //   1. SQL INSERT a 'TEST LWW' game_table → INSERT event → direct-apply
  //      creates the Dexie row ("applied" log).
  //   2. "Bump TEST LWW +1h" — raw local updatedAt = now + 1h (raw update,
  //      NOT syncedUpdate: no outbox row, we're testing LWW not the guard).
  //   3. SQL UPDATE with updated_at = now() (OLDER than local) → event →
  //      "skipped (local ... newer ...)" and the local name survives.
  //   4. SQL UPDATE with updated_at = now() + interval '2 hours' (NEWER) →
  //      event → "applied" and the Dexie name changes.
  //   5. SQL DELETE + "Clean TEST LWW (local)" — DELETE event logs the
  //      doorbell-fallback warn (that branch proven too).
  const bumpLwwRow = async () => {
    try {
      const row = await db.gameTables.filter((t) => t.name?.startsWith('TEST LWW') ?? false).first()
      if (!row || !row.id) {
        log('bumpLwwRow', false, {
          hint: 'No local TEST LWW row. Run this in the SQL editor first and wait for the realtime "applied" console line:',
          sql: "insert into public.game_tables (id, club_id, name, table_type, hourly_rate) values (gen_random_uuid(), (select id from public.clubs limit 1), 'TEST LWW', 'pool', 100);",
        })
        return
      }
      const bumped = Date.now() + 60 * 60 * 1000
      await db.gameTables.update(row.id, { updatedAt: bumped })
      log('bumpLwwRow', true, {
        id: row.id,
        name: row.name,
        localUpdatedAt: bumped,
        step3_stale_sql: `update public.game_tables set name = 'TEST LWW STALE', updated_at = now() where id = '${row.id}';`,
        step4_newer_sql: `update public.game_tables set name = 'TEST LWW NEWER', updated_at = now() + interval '2 hours' where id = '${row.id}';`,
        step5_cleanup_sql: `delete from public.game_tables where name like 'TEST LWW%';`,
      })
    } catch (e) {
      log('bumpLwwRow', false, String(e))
    }
  }

  const cleanLwwLocal = async () => {
    try {
      const n = await db.gameTables.filter((t) => t.name?.startsWith('TEST LWW') ?? false).delete()
      log('cleanLwwLocal', true, `${n} local TEST LWW row(s) deleted from Dexie`)
    } catch (e) {
      log('cleanLwwLocal', false, String(e))
    }
  }

  // The runtime-proof payload: per synced table, row count + up to
  // DUMP_LIMIT raw Dexie rows (exact stored shape, straight out of
  // IndexedDB via Dexie).
  const dumpTables = async () => {
    try {
      const dump: Record<string, { count: number; rows: unknown[] }> = {}
      for (const syncTable of SYNC_TABLES_PULL_ORDER) {
        const dexieTable = dexieTableFor(syncTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const table = (db as any)[dexieTable]
        const count: number = await table.count()
        const rows: unknown[] = await table.limit(DUMP_LIMIT).toArray()
        dump[syncTable] = { count, rows }
      }
      const settings = await db.settings.get(1)
      log('dumpTables', true, { tables: dump, pullCursors: settings?.pullCursors ?? {} })
    } catch (e) {
      log('dumpTables', false, String(e))
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-xl font-semibold mb-2">/__dev/test-sync-reader</h1>
        <p className="text-slate-400 text-sm mb-6">
          Phase C Chunk 5.2b — SyncReader runtime proof. Requires sign-in.
          Flow: seed rows in Supabase → Reset cursors → Force pull → Dump
          synced tables, then check <code>*At</code> fields are numbers, no
          snake_case timestamps, nested objects are real objects.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-6">
          <button onClick={resetCursors} className="bg-amber-700 hover:bg-amber-600 px-3 py-2 rounded text-sm">
            1. Reset pull cursors
          </button>
          <button onClick={forcePull} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-2 rounded text-sm">
            2. Force pull (restart reader)
          </button>
          <button onClick={dumpTables} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm">
            3. Dump synced tables
          </button>
          <button onClick={bumpLwwRow} className="bg-indigo-700 hover:bg-indigo-600 px-3 py-2 rounded text-sm">
            LWW: bump TEST LWW +1h (logs SQL steps)
          </button>
          <button onClick={cleanLwwLocal} className="bg-red-800 hover:bg-red-700 px-3 py-2 rounded text-sm">
            LWW: clean TEST LWW (local)
          </button>
        </div>

        <div className="space-y-3">
          {logs.length === 0 && <p className="text-slate-500 text-sm">No runs yet.</p>}
          {logs.map((entry, i) => (
            <div
              key={i}
              className={`border rounded p-3 ${
                entry.ok ? 'border-emerald-700 bg-emerald-900/20' : 'border-red-700 bg-red-900/20'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm">
                  {entry.ts} — {entry.label}
                </span>
                <span className={`text-xs font-semibold ${entry.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {entry.ok ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <pre className="text-[11px] text-slate-300 overflow-x-auto bg-slate-950/50 p-2 rounded">
                {JSON.stringify(entry.detail, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
