import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useToastStore } from '../store/toastStore'
import {
  getCanteenItems,
  getLowStockThreshold,
  getPiggyBalance,
  softDeleteCanteenItem,
} from '../db/queries'
import { Modal } from '../components/Modal'
import { CanteenItemFormModal } from '../components/CanteenItemFormModal'
import { RestockSheet } from '../components/RestockSheet'
import type { CanteenItem } from '../types'

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

interface StockPillProps {
  item: CanteenItem
  threshold: number
}

function StockPill({ item, threshold }: StockPillProps) {
  if (!item.stockEnabled) {
    return (
      <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-border text-text-faint whitespace-nowrap">
        No stock tracking
      </span>
    )
  }
  const stock = item.currentStock ?? 0
  if (stock === 0) {
    return (
      <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-busy/15 text-busy whitespace-nowrap">
        Out of stock
      </span>
    )
  }
  if (stock < threshold) {
    return (
      <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-paused/15 text-paused whitespace-nowrap">
        {stock} left ⚠️
      </span>
    )
  }
  return (
    <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-full bg-free/12 text-free whitespace-nowrap">
      {stock} in stock
    </span>
  )
}

function StatsRow({ items, threshold }: { items: CanteenItem[] | undefined; threshold: number }) {
  if (items === undefined) {
    return <p className="text-xs text-text-faint mb-4 pl-1">Loading items…</p>
  }
  const lowStockCount = items.filter(
    (i) => i.stockEnabled && i.currentStock !== null && i.currentStock > 0 && i.currentStock < threshold,
  ).length
  return (
    <p className="text-xs text-text-faint mb-4 pl-1">
      {items.length} item{items.length !== 1 ? 's' : ''}
      {lowStockCount > 0 && <span className="text-paused"> · {lowStockCount} low stock</span>}
    </p>
  )
}

function ListArea({
  items,
  threshold,
  onEdit,
  onDelete,
  onRestock,
}: {
  items: CanteenItem[] | undefined
  threshold: number
  onEdit: (item: CanteenItem) => void
  onDelete: (item: CanteenItem) => void
  onRestock: (item: CanteenItem) => void
}) {
  if (items === undefined) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-bg-card border border-border rounded-2xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-faint"
        >
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <p className="text-text-dim text-sm text-center">No canteen items yet.{'\n'}Tap + to add one.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="bg-bg-card border border-border rounded-2xl p-4"
        >
          {/* Row 1: Name + price + Stock pill + Edit + Delete */}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-bold text-text truncate">{item.name}</p>
              <p className="text-sm text-text-dim mt-0.5">{formatINR(item.defaultPrice)}</p>
            </div>

            <StockPill item={item} threshold={threshold} />

            <button
              onClick={() => onEdit(item)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim shrink-0"
              aria-label={`Edit ${item.name}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>

            <button
              onClick={() => onDelete(item)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-busy shrink-0"
              aria-label={`Delete ${item.name}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>

          {/* Row 2: Restock button (full-width-ish, secondary style) */}
          <button
            onClick={() => onRestock(item)}
            className="mt-3 bg-bg border border-border h-9 px-3 rounded-xl text-text-dim text-[12px] font-semibold flex items-center gap-1.5 active:scale-[0.98] transition-transform"
            aria-label={`Restock ${item.name}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v6h-6" />
            </svg>
            Restock
          </button>
        </div>
      ))}
    </div>
  )
}

export default function Canteen() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<CanteenItem | undefined>()
  const [deletingItem, setDeletingItem] = useState<CanteenItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restockItem, setRestockItem] = useState<CanteenItem | null>(null)

  // undefined = still loading; [] = loaded, empty; [...] = loaded, has items
  const items = useLiveQuery<CanteenItem[] | undefined>(() => getCanteenItems(false), [])
  const allItems = useLiveQuery<CanteenItem[] | undefined>(() => getCanteenItems(true), [])
  const threshold = useLiveQuery(() => getLowStockThreshold(), [], 5) ?? 5
  // Piggy balance — live, used by RestockSheet to gate the Piggy source option
  const piggy = useLiveQuery(() => getPiggyBalance(), [])
  const piggyCurrent = Math.max(0, piggy?.current ?? 0)

  function openAdd() {
    setEditingItem(undefined)
    setModalOpen(true)
  }

  function openEdit(item: CanteenItem) {
    setEditingItem(item)
    setModalOpen(true)
  }

  async function handleConfirmDelete() {
    if (!deletingItem?.id) return
    setDeleting(true)
    try {
      await softDeleteCanteenItem(deletingItem.id)
      showToast(`${deletingItem.name} deleted`, 'success')
      setDeletingItem(null)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete item', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-bg min-h-screen pb-24">
      <div className="px-5">
        {/* Header — always rendered */}
        <div className="flex items-center gap-3 pt-4 pb-2">
          <button
            onClick={() => navigate(-1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-[20px] font-bold text-text">Canteen</h1>
        </div>

        {/* Stats — always rendered, handles undefined inside */}
        <StatsRow items={items} threshold={threshold} />

        {/* List area — skeleton / empty / cards */}
        <ListArea
          items={items}
          threshold={threshold}
          onEdit={openEdit}
          onDelete={setDeletingItem}
          onRestock={setRestockItem}
        />
      </div>

      {/* FAB — always rendered */}
      <button
        onClick={openAdd}
        className="fixed bottom-20 right-5 w-14 h-14 bg-accent text-bg rounded-2xl flex items-center justify-center text-2xl font-bold z-50 active:scale-95 transition-transform"
        style={{ boxShadow: '0 0 24px rgba(184,255,90,0.35), 0 4px 12px rgba(0,0,0,0.4)' }}
        aria-label="Add canteen item"
      >
        +
      </button>

      {/* Add / Edit modal */}
      <CanteenItemFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        item={editingItem}
        existingItems={allItems ?? []}
      />

      {/* Restock bottom sheet */}
      <RestockSheet
        open={restockItem !== null}
        item={restockItem}
        piggyBalance={piggyCurrent}
        onCancel={() => setRestockItem(null)}
        onSaved={({ quantityAdded, cost, source }) => {
          const name = restockItem?.name ?? 'Item'
          const piggyTail =
            source === 'piggy'
              ? ` · piggy ₹${Math.max(0, piggyCurrent - cost).toLocaleString('en-IN')}`
              : ''
          showToast(`Restocked: ${name} +${quantityAdded}${piggyTail}`, 'success')
          setRestockItem(null)
        }}
      />

      {/* Delete confirm modal */}
      <Modal
        open={deletingItem !== null}
        onClose={() => !deleting && setDeletingItem(null)}
        title={`Delete ${deletingItem?.name ?? ''}?`}
      >
        <p className="text-text-dim text-sm mb-5">
          This item will be removed from the canteen list. Past sales history is preserved.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDeletingItem(null)}
            disabled={deleting}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
