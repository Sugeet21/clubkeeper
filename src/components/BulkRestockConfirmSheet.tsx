// #173 Chunk 4 — Confirm summary + double-tap-guarded write for Bulk Restock.
//
// Shows the filled rows ("11 items, 41 units") BEFORE anything is written (R8).
// On confirm, runs confirmBulkRestock (sequential recordStockPurchase loop —
// cost:0/source:'other' forced, R9) with a progress readout ("12 / 41…"), then
// reports "N applied" + any failures without aborting the batch. On success the
// caller clears the draft (R6).
//
// DOUBLE-TAP GUARD (R8): a useRef flag is flipped SYNCHRONOUSLY at the top of the
// handler, BEFORE the first await — because setState is async, a fast second tap
// can fire before the disabled `submitting` state has re-rendered. The ref is the
// real guard; `submitting` only drives the button UI. The guard is NOT "the sheet
// closed" — the sheet stays open through the whole write.
//
// NO network await: confirmBulkRestock is local Dexie (syncedBatch returns
// immediately); the outbox syncs later.

import { useRef, useState } from 'react'
import { confirmBulkRestock, type BulkRestockRow, type BulkRestockResult } from '../db/queries'
import type { CanteenItem } from '../types'

interface Props {
  open: boolean
  rows: BulkRestockRow[]              // filled rows only (parsed, qty > 0) — whole draft, search-independent
  itemsById: Record<string, CanteenItem>
  batchId: string
  onCancel: () => void
  onDone: (result: BulkRestockResult) => void  // caller clears the draft + navigates
}

export function BulkRestockConfirmSheet({ open, rows, itemsById, batchId, onCancel, onDone }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // The real guard — flipped synchronously before any await (R8).
  const inFlight = useRef(false)

  if (!open) return null

  const totalUnits = rows.reduce((sum, r) => sum + r.quantityAdded, 0)

  async function handleConfirm() {
    // SYNCHRONOUS guard FIRST — before any await, before setState. A second tap
    // in the same tick sees inFlight=true and returns immediately.
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    setProgress(0)

    try {
      // confirmBulkRestock loops internally; for a live "12 / 41…" readout we run
      // the same forced-cost/source write here row-by-row via the exported helper,
      // bumping progress between rows. (Kept as one call would hide progress.)
      // We call confirmBulkRestock per-row so each row's atomic tx is preserved
      // AND we can surface progress — the helper batches a single batchId note.
      let done = 0
      const applied: BulkRestockResult['applied'] = []
      const failed: BulkRestockResult['failed'] = []
      for (const row of rows) {
        const partial = await confirmBulkRestock([row], batchId)
        applied.push(...partial.applied)
        failed.push(...partial.failed)
        done += 1
        setProgress(done)
      }
      onDone({ batchId, applied, failed })
    } catch (e) {
      // confirmBulkRestock already swallows per-row errors into `failed`, so a
      // throw here is unexpected (e.g. Dexie closed). Surface + re-enable.
      setError(e instanceof Error ? e.message : String(e))
      inFlight.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={() => !submitting && onCancel()}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] bg-bg-card rounded-t-3xl border-t border-border max-h-[85vh] flex flex-col"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
            Confirm bulk restock
          </p>
          <p className="text-text text-base font-semibold mt-0.5">
            {rows.length} {rows.length === 1 ? 'item' : 'items'} · {totalUnits} units
          </p>
        </div>

        {/* Summary — every filled row, so a typo of 40-for-4 is visible before write. */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3 space-y-1.5">
          {rows.map((r) => {
            const item = itemsById[r.canteenItemId]
            const cur = item?.currentStock ?? 0
            return (
              <div key={r.canteenItemId} className="flex items-center gap-3 text-[14px]">
                <span className="flex-1 min-w-0 break-words text-text">{item?.name ?? r.canteenItemId}</span>
                <span className="font-mono tabular-nums text-text-faint shrink-0">
                  {cur} → <span className="text-accent font-bold">{cur + r.quantityAdded}</span>
                  <span className="text-text-dim"> (+{r.quantityAdded})</span>
                </span>
              </div>
            )
          })}
          {error && <p className="text-busy text-[13px] text-center pt-2">{error}</p>}
        </div>

        <div className="shrink-0 px-5 pt-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={() => void handleConfirm()}
            disabled={submitting || rows.length === 0}
            className={
              submitting || rows.length === 0
                ? 'w-full bg-bg text-text-faint border border-border font-semibold py-4 rounded-2xl min-h-[48px] opacity-60 cursor-not-allowed'
                : 'w-full bg-accent text-bg font-bold py-4 rounded-2xl min-h-[48px] active:scale-[0.98] transition-transform'
            }
          >
            {submitting ? `Saving ${progress} / ${rows.length}…` : `Confirm restock`}
          </button>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full bg-bg-card text-text-dim border border-border py-3 rounded-2xl min-h-[44px] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}
