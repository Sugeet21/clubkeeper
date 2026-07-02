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
