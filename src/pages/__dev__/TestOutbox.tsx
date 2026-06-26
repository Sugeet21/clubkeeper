// Phase C Chunk 3 — manual smoke-test page for the sync wrappers.
//
// DEV-only route mounted at /__dev/test-outbox (guarded in App.tsx by
// import.meta.env.DEV). Provides four buttons that exercise each wrapper
// against the live per-user Dexie instance and dump the resulting outbox
// rows + data rows so you can visually verify atomic-tx behavior.
//
// Test rows use real `crypto.randomUUID()` ids (Supabase id columns are
// `uuid` and reject anything else — see bug_patterns.md Pattern S14
// watch-out). Identification is via the `TEST ` prefix on the `name` field
// (or `items[0].name` for canteen_sales). Cleanup filters by that prefix.
//
// Run pipeline:
//   1. Sign in (Chunk 1 useCurrentUser must report 'signed_in') — wrappers
//      require dbReady which depends on auth.
//   2. Visit http://localhost:5173/__dev/test-outbox
//   3. Click each test button in order, eyeball the output.
//   4. Click "Clean test rows" to purge.

import { useState } from 'react'
import { db } from '../../db/database'
import {
  syncedCreate,
  syncedUpdate,
  syncedSoftDelete,
  syncedCreateBatch,
} from '../../db/syncWrappers'
import { syncRunner } from '../../db/syncRunner'

const TEST_NAME_PREFIX = 'TEST '

interface LogEntry {
  ts: string
  label: string
  ok: boolean
  detail: unknown
}

export default function TestOutbox() {
  const [logs, setLogs] = useState<LogEntry[]>([])

  const log = (label: string, ok: boolean, detail: unknown) => {
    setLogs((prev) => [
      { ts: new Date().toISOString().slice(11, 23), label, ok, detail },
      ...prev,
    ])
  }

  const runCreateTest = async () => {
    try {
      const id = crypto.randomUUID()
      const row = {
        id,
        phone: null,
        name: 'TEST Customer A',
        walkInCode: null,
        walletBalance: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
        updated_at: new Date().toISOString(),
      }
      await syncedCreate('customers', row)

      // Read back from BOTH tables
      const dataRow = await db.customers.get(id)
      const outboxRows = await db._outbox.where('rowId').equals(id).toArray()

      const passed = !!dataRow && outboxRows.length === 1 && outboxRows[0].op === 'insert'
      log('syncedCreate', passed, { dataRow, outboxRows })
    } catch (e) {
      log('syncedCreate', false, String(e))
    }
  }

  const runUpdateTest = async () => {
    try {
      const id = crypto.randomUUID()
      // Seed a row first (via wrapper so outbox has a baseline)
      await syncedCreate('customers', {
        id,
        phone: null,
        name: 'TEST Customer B',
        walkInCode: null,
        walletBalance: 100,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
        updated_at: new Date().toISOString(),
      })
      // Now update
      await syncedUpdate('customers', id, { name: 'TEST Customer B (renamed)', walletBalance: 250 })

      const dataRow = await db.customers.get(id)
      const outboxRows = await db._outbox.where('rowId').equals(id).toArray()

      const updateRow = outboxRows.find((r) => r.op === 'update')
      const payload = updateRow?.payload as { name: string; walletBalance: number } | undefined

      const passed =
        outboxRows.length === 2 &&
        !!updateRow &&
        dataRow?.name === 'TEST Customer B (renamed)' &&
        dataRow?.walletBalance === 250 &&
        payload?.name === 'TEST Customer B (renamed)' &&
        payload?.walletBalance === 250

      log('syncedUpdate', passed, { dataRow, outboxRows })
    } catch (e) {
      log('syncedUpdate', false, String(e))
    }
  }

  const runSoftDeleteTest = async () => {
    try {
      const id = crypto.randomUUID()
      await syncedCreate('customers', {
        id,
        phone: null,
        name: 'TEST Customer C',
        walkInCode: null,
        walletBalance: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
        updated_at: new Date().toISOString(),
      })
      await syncedSoftDelete('customers', id)

      const dataRow = await db.customers.get(id)
      const outboxRows = await db._outbox.where('rowId').equals(id).toArray()

      const deleteRow = outboxRows.find((r) => r.op === 'soft_delete')
      const payload = deleteRow?.payload as { deleted_at: string } | undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dataDeletedAt = (dataRow as any)?.deleted_at as string | undefined

      const passed =
        outboxRows.length === 2 &&
        !!deleteRow &&
        typeof dataDeletedAt === 'string' &&
        typeof payload?.deleted_at === 'string' &&
        dataDeletedAt === payload.deleted_at

      log('syncedSoftDelete', passed, { dataRow, outboxRows })
    } catch (e) {
      log('syncedSoftDelete', false, String(e))
    }
  }

  const runBatchTest = async () => {
    try {
      const customerId = crypto.randomUUID()
      const saleId = crypto.randomUUID()

      await syncedCreateBatch([
        {
          table: 'customers',
          row: {
            id: customerId,
            phone: null,
            name: 'TEST Customer D',
            walkInCode: null,
            walletBalance: 50,
            createdAt: Date.now(),
            lastVisitAt: Date.now(),
            updated_at: new Date().toISOString(),
          },
        },
        {
          table: 'canteen_sales',
          row: {
            id: saleId,
            createdAt: Date.now(),
            items: [{ name: 'TEST Item', price: 50, quantity: 1 }],
            subtotal: 50,
            paymentBreakdown: { cash: 0, upi: 0, wallet: 50 },
            total: 50,
            customerId,
            updated_at: new Date().toISOString(),
          },
        },
      ])

      const customer = await db.customers.get(customerId)
      const sale = await db.canteenSales.get(saleId)
      const outboxRows = await db._outbox
        .filter((r) => r.rowId === customerId || r.rowId === saleId)
        .toArray()

      const passed = !!customer && !!sale && outboxRows.length === 2
      log('syncedCreateBatch', passed, { customer, sale, outboxRows })
    } catch (e) {
      log('syncedCreateBatch', false, String(e))
    }
  }

  // Phase C Chunk 4 — force a drain pass immediately (bypasses the 30s
  // heartbeat wait so smoke-tests are interactive).
  const forceDrain = async () => {
    try {
      await syncRunner.scheduleDrain()
      const remaining = await db._outbox.count()
      log('forceDrain', true, { outboxRemaining: remaining })
    } catch (e) {
      log('forceDrain', false, String(e))
    }
  }

  // Phase C Chunk 4 — show every dead-letter row (stuck === true). These
  // never drain again on their own; manual intervention required.
  const showDeadLetter = async () => {
    try {
      const all = await db._outbox.toArray()
      const stuck = all.filter((r) => r.stuck === true)
      log('showDeadLetter', true, { stuckCount: stuck.length, stuck })
    } catch (e) {
      log('showDeadLetter', false, String(e))
    }
  }

  // Phase C Chunk 4 — RLS-failure smoke test. Seeds a customer row with a
  // hard-coded wrong club_id (all-zeros UUID), kicks the runner, and waits a
  // moment. Expected: outbox row stays with attempts > 0 and lastError set.
  // Eventually (after 10 attempts via repeated drains) the row would flip to
  // stuck=true. This single click only proves attempt #1 lands in lastError.
  const rlsFailTest = async () => {
    try {
      const id = crypto.randomUUID()
      const wrongClubId = '00000000-0000-0000-0000-000000000000'
      await syncedCreate('customers', {
        id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        club_id: wrongClubId as any,
        phone: null,
        name: 'TEST RLS-fail Customer',
        walkInCode: null,
        walletBalance: 0,
        createdAt: Date.now(),
        lastVisitAt: Date.now(),
        updated_at: new Date().toISOString(),
      })

      // scheduleDrain awaits the full drainOnce internally — by the time it
      // resolves, the outbox row's attempts/lastError are already committed
      // to Dexie. No external sleep needed.
      await syncRunner.scheduleDrain()

      const outboxRow = (await db._outbox.where('rowId').equals(id).toArray())[0]
      const passed =
        !!outboxRow &&
        outboxRow.attempts > 0 &&
        typeof outboxRow.lastError === 'string' &&
        outboxRow.lastError.length > 0

      log('rlsFailTest', passed, { outboxRow })
    } catch (e) {
      log('rlsFailTest', false, String(e))
    }
  }

  // Phase C Chunk 4.2 — total reset. Wipes ALL outbox rows (including any
  // legitimate pre-Chunk-4 leftovers — fine in DEV) plus any data rows
  // whose name starts with "TEST ". Does NOT touch Supabase.
  const isTestCustomer = (c: { name?: string | null }) =>
    typeof c.name === 'string' && c.name.startsWith(TEST_NAME_PREFIX)
  const isTestSale = (s: { items?: Array<{ name?: string | null }> }) =>
    typeof s.items?.[0]?.name === 'string' && s.items[0].name.startsWith(TEST_NAME_PREFIX)

  const clearOutbox = async () => {
    try {
      const outboxBefore = await db._outbox.count()
      const customers = await db.customers.toArray()
      const sales = await db.canteenSales.toArray()
      const customersToDelete = customers.filter(isTestCustomer)
      const salesToDelete = sales.filter(isTestSale)

      await db.transaction('rw', [db.customers, db.canteenSales, db._outbox], async () => {
        await db._outbox.clear()
        await Promise.all(customersToDelete.map((c) => db.customers.delete(c.id)))
        await Promise.all(salesToDelete.map((s) => db.canteenSales.delete(s.id)))
      })

      log('clearOutbox', true, {
        outboxRowsCleared: outboxBefore,
        testCustomersCleared: customersToDelete.length,
        testSalesCleared: salesToDelete.length,
      })
    } catch (e) {
      log('clearOutbox', false, String(e))
    }
  }

  const cleanup = async () => {
    try {
      const customers = await db.customers.toArray()
      const sales = await db.canteenSales.toArray()

      const customersToDelete = customers.filter(isTestCustomer)
      const salesToDelete = sales.filter(isTestSale)
      const testIds = new Set<string>([
        ...customersToDelete.map((c) => c.id),
        ...salesToDelete.map((s) => s.id),
      ])
      const outboxAll = await db._outbox.toArray()
      const outboxToDelete = outboxAll.filter(
        (r) => typeof r.rowId === 'string' && testIds.has(r.rowId),
      )

      await db.transaction('rw', [db.customers, db.canteenSales, db._outbox], async () => {
        await Promise.all(customersToDelete.map((c) => db.customers.delete(c.id)))
        await Promise.all(salesToDelete.map((s) => db.canteenSales.delete(s.id)))
        await Promise.all(outboxToDelete.map((r) => db._outbox.delete(r.seq as number)))
      })

      log('cleanup', true, {
        customersDeleted: customersToDelete.length,
        salesDeleted: salesToDelete.length,
        outboxDeleted: outboxToDelete.length,
      })
    } catch (e) {
      log('cleanup', false, String(e))
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <div className="max-w-[1400px] mx-auto">
        <h1 className="text-xl font-semibold mb-2">/__dev/test-outbox</h1>
        <p className="text-slate-400 text-sm mb-6">
          Phase C Chunk 3 — sync wrapper smoke tests. Requires you to be signed
          in (dbReady === true). Test rows use real UUIDs (Supabase requires
          it); they're identified by the <code>TEST </code> prefix on the name
          field.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <button onClick={runCreateTest} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm">
            syncedCreate
          </button>
          <button onClick={runUpdateTest} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm">
            syncedUpdate
          </button>
          <button onClick={runSoftDeleteTest} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm">
            syncedSoftDelete
          </button>
          <button onClick={runBatchTest} className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-sm">
            syncedCreateBatch
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
          <button onClick={forceDrain} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-2 rounded text-sm">
            Force drain now
          </button>
          <button onClick={showDeadLetter} className="bg-amber-700 hover:bg-amber-600 px-3 py-2 rounded text-sm">
            Show dead-letter
          </button>
          <button onClick={rlsFailTest} className="bg-purple-700 hover:bg-purple-600 px-3 py-2 rounded text-sm">
            RLS-fail test
          </button>
          <button onClick={clearOutbox} className="bg-orange-700 hover:bg-orange-600 px-3 py-2 rounded text-sm">
            Clear outbox (DEV)
          </button>
          <button onClick={cleanup} className="bg-red-700 hover:bg-red-600 px-3 py-2 rounded text-sm">
            Clean test rows
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
