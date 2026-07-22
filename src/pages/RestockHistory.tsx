// #173 Chunk 5 — Bulk Restock Batch History + Reverse (owner-only).
//
// Lists BATCHES (not rows): date, item count, total units. Tap a batch → its
// rows → "Reverse this batch" writes a COMPENSATING adjustment (reverseRestockBatch;
// kind='reversal', currentStock -= qty). Never hard-deletes / edits historical
// rows. Per-row editing is out of scope (reverse + re-enter).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { db } from '../db/database'
import { Modal } from '../components/Modal'
import { useToastStore } from '../store/toastStore'
import {
  listRestockBatches,
  reverseRestockBatch,
  RestockBatchError,
  type RestockBatch,
} from '../db/queries'

export default function RestockHistory() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  // Re-derives on any stockPurchases change (reverse writes a row → refresh).
  const batches = useLiveQuery(() => listRestockBatches(), [])
  // Item names for the row detail (small table, read once).
  const itemsById = useLiveQuery(async () => {
    const items = await db.canteenItems.toArray()
    const m: Record<string, string> = {}
    for (const it of items) if (it.id) m[it.id] = it.name
    return m
  }, [])

  const [openBatch, setOpenBatch] = useState<RestockBatch | null>(null)
  const [confirmReverse, setConfirmReverse] = useState<RestockBatch | null>(null)
  const [reversing, setReversing] = useState(false)

  async function handleReverse() {
    if (!confirmReverse || reversing) return
    setReversing(true)
    try {
      const { reversedRows } = await reverseRestockBatch(confirmReverse.batchId)
      showToast(`Reversed ${reversedRows} ${reversedRows === 1 ? 'row' : 'rows'}`, 'success')
      setConfirmReverse(null)
      setOpenBatch(null)
    } catch (e) {
      const msg = e instanceof RestockBatchError ? e.message : 'Could not reverse the batch.'
      showToast(msg, 'error')
    } finally {
      setReversing(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg text-text pb-8">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border">
        {/* Back = pop (navigate(-1)), never push a route — see BulkRestock RCA. */}
        <button
          onClick={() => navigate(-1)}
          className="text-text-dim text-sm min-h-[44px] px-1 -ml-1 active:text-text transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-[16px] font-bold ml-1">Restock history</h1>
      </div>

      {batches === undefined && (
        <p className="px-4 py-8 text-center text-text-faint text-sm">Loading…</p>
      )}
      {batches && batches.length === 0 && (
        <p className="px-4 py-10 text-center text-text-faint text-sm">
          No bulk restocks yet.
        </p>
      )}

      {batches?.map((batch) => (
        <button
          key={batch.batchId}
          onClick={() => setOpenBatch(batch)}
          className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-border text-left active:bg-bg-card transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-[14px] text-text font-semibold">
              {format(new Date(batch.createdAt), 'd MMM yyyy, h:mm a')}
            </p>
            <p className="text-[12px] text-text-faint mt-0.5">
              {batch.itemCount} {batch.itemCount === 1 ? 'item' : 'items'} · {batch.totalUnits} units
            </p>
          </div>
          {batch.reversed ? (
            <span className="shrink-0 text-[10px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-busy/15 text-busy leading-none">
              reversed
            </span>
          ) : (
            <span className="text-text-faint text-[18px] shrink-0">›</span>
          )}
        </button>
      ))}

      {/* Batch detail — rows + Reverse action */}
      <Modal
        open={openBatch !== null}
        onClose={() => setOpenBatch(null)}
        title={openBatch ? format(new Date(openBatch.createdAt), 'd MMM, h:mm a') : ''}
      >
        {openBatch && (
          <>
            <div className="space-y-1.5 mb-4 max-h-[50vh] overflow-y-auto">
              {openBatch.rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-[14px]">
                  <span className="flex-1 min-w-0 break-words text-text">
                    {itemsById?.[r.canteenItemId] ?? r.canteenItemId}
                  </span>
                  <span className="font-mono tabular-nums text-accent font-bold shrink-0">
                    +{r.quantityAdded}
                  </span>
                </div>
              ))}
            </div>
            {openBatch.reversed ? (
              <p className="text-[13px] text-text-faint text-center py-2">
                This batch has already been reversed.
              </p>
            ) : (
              <button
                onClick={() => setConfirmReverse(openBatch)}
                className="w-full min-h-[44px] py-3 bg-busy/10 text-busy border border-busy/30 rounded-xl text-[14px] font-semibold active:bg-busy/20 transition-colors"
              >
                Reverse this batch
              </button>
            )}
          </>
        )}
      </Modal>

      {/* Reverse confirm */}
      <Modal
        open={confirmReverse !== null}
        onClose={() => !reversing && setConfirmReverse(null)}
        title="Reverse this batch?"
      >
        {confirmReverse && (
          <>
            <p className="text-text-dim text-sm mb-5">
              This subtracts {confirmReverse.totalUnits} units back out of{' '}
              {confirmReverse.itemCount} {confirmReverse.itemCount === 1 ? 'item' : 'items'}. The
              original entry stays in the history; a matching reversal is recorded. Stock won't go
              below 0.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfirmReverse(null)}
                disabled={reversing}
                className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleReverse()}
                disabled={reversing}
                className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
              >
                {reversing ? 'Reversing…' : 'Reverse'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
