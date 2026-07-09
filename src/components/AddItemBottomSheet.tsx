import { useState, useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSessionItems, useRecentItems, useSettings } from '../hooks/useLiveData'
import { addSessionItem, addOrIncrementSessionItem, updateSessionItem, deleteSessionItem, restoreSessionItem, getCanteenItems, getLowStockThreshold, InsufficientStockError } from '../db/queries'
import { db } from '../db/database'
import { syncedBatch } from '../db/syncWrappers'
import { useToastStore } from '../store/toastStore'
import { validateItemName } from '../lib/validation'
import { normalizeName, findMatchingCanteenItem, findCanteenItemByName } from '../lib/canteenMatch'
import { getEffectivePrice, getPeakConfig, isInPeakWindow } from '../lib/peakPricing'
import type { SessionItem, CanteenItem } from '../types'

// ─── Icons ────────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddItemBottomSheetProps {
  open: boolean
  onClose: () => void
  sessionId: number
  sessionStatus: 'running' | 'paused' | 'completed'
}

// ─── Shared inline atomic transaction ────────────────────────────────────────
// Pattern D7/S24: one syncedBatch — stock logic INLINED, NOT via
// decrementCanteenItemStock() or addOrIncrementSessionItem() (both open their
// own tx). Group C (#126): stock check → decrement + session-item merge stay
// atomic with their outbox rows.

async function runCanteenAddTransaction(
  ci: CanteenItem,
  sessionId: number,
  itemName: string,
  priceNum: number,
  qtyNum: number,
): Promise<{ oldStock: number; newStock: number } | null> {
  if (!ci.stockEnabled || ci.id === undefined) return null
  let crossing: { oldStock: number; newStock: number } | null = null
  await syncedBatch(['canteen_items', 'session_items'], async (b) => {
    const fresh = await db.canteenItems.get(ci.id!)
    if (!fresh) throw new Error('Canteen item not found')
    const oldStock = fresh.currentStock ?? 0
    const newStock = oldStock - qtyNum
    if (newStock < 0) throw new Error('Insufficient stock')
    await b.update('canteen_items', ci.id!, { currentStock: newStock })
    // Inline merge — do NOT call addOrIncrementSessionItem here (Pattern D7)
    const normalized = normalizeName(itemName)
    // #124 — !deletedAt: matching a tombstoned row would increment an
    // invisible item instead of inserting a visible one
    const existing = await db.sessionItems
      .where('sessionId')
      .equals(sessionId)
      .filter(item => !item.deletedAt && normalizeName(item.name) === normalized && item.price === priceNum)
      .first()
    if (existing && existing.id != null) {
      await b.update('session_items', existing.id, { quantity: Math.min(99, existing.quantity + qtyNum) })
    } else {
      const row = { id: crypto.randomUUID(), sessionId, name: itemName.trim(), price: priceNum, quantity: qtyNum, addedAt: Date.now() }
      await b.insert('session_items', row)
    }
    crossing = { oldStock, newStock }
  })
  return crossing
}

async function runFreeformAddTransaction(
  sessionId: number,
  itemName: string,
  priceNum: number,
  qtyNum: number,
): Promise<void> {
  await addOrIncrementSessionItem({ sessionId, name: itemName, price: priceNum, quantity: qtyNum })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddItemBottomSheet({
  open,
  onClose,
  sessionId,
  sessionStatus,
}: AddItemBottomSheetProps) {
  const items = useSessionItems(sessionId)
  const recentItems = useRecentItems(8)
  const canteenItems = useLiveQuery(() => getCanteenItems(false), [], [] as CanteenItem[])
  const settings = useSettings()
  const { show: showToast } = useToastStore()

  // Peak Hour Pricing (#68 Phase 3) — re-evaluate every 60s while sheet is open
  // so chips swap automatically as the window opens/closes mid-session.
  const peakCfg = getPeakConfig(settings)
  const [peakNow, setPeakNow] = useState<Date>(() => new Date())
  useEffect(() => {
    if (!open || !peakCfg.enabled) return
    const id = window.setInterval(() => setPeakNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [open, peakCfg.enabled])
  const peakActive = isInPeakWindow(peakNow, peakCfg)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [selectedCanteenItem, setSelectedCanteenItem] = useState<CanteenItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [priceWarning, setPriceWarning] = useState<{ canteenItem: CanteenItem } | null>(null)

  const isReadOnly = sessionStatus === 'completed'

  // Quick Add shows ONLY canteen-matched recent items
  const quickAddItems = useMemo(() => {
    if (!canteenItems || canteenItems.length === 0) return []
    return recentItems.filter(item =>
      findMatchingCanteenItem(item.name, item.lastPrice, canteenItems) !== null
    )
  }, [recentItems, canteenItems])

  // ESC key handler (Pattern M2)
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Reset form when sheet closes
  useEffect(() => {
    if (!open) {
      setEditingId(null)
      setName('')
      setPrice('')
      setQuantity('1')
      setSelectedCanteenItem(null)
      setError(null)
      setManualOpen(false)
      setPriceWarning(null)
    }
  }, [open])

  // ─── Validate while typing ────────────────────────────────────────────────

  function validateForm(): string | null {
    const nameErr = validateItemName(name)
    if (nameErr) return nameErr
    const priceNum = Number(price)
    if (!price || !Number.isInteger(priceNum) || priceNum < 0 || priceNum > 99999) {
      return 'Price must be a whole number, 0–99999'
    }
    const qtyNum = Number(quantity)
    if (!quantity || !Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 99) {
      return 'Quantity must be 1–99'
    }
    return null
  }

  const formError = validateForm()
  const hasInput = name.trim().length > 0 || price.length > 0

  // ─── Toast helper for low-stock crossing ─────────────────────────────────

  async function fireStockToastIfNeeded(ci: CanteenItem, crossing: { oldStock: number; newStock: number } | null) {
    if (!crossing || !ci.stockEnabled) return
    const { oldStock, newStock } = crossing
    const threshold = await getLowStockThreshold()
    if (newStock === 0) {
      showToast(`${ci.name} out of stock`, 'error')
    } else if (oldStock > threshold && newStock <= threshold) {
      showToast(`⚠️ ${ci.name} stock low — ${newStock} left`, 'info')
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleStartEdit(item: SessionItem) {
    setEditingId(item.id!)
    setName(item.name)
    setPrice(String(item.price))
    setQuantity(String(item.quantity))
    setError(null)
  }

  function handleCancelEdit() {
    setEditingId(null)
    setName('')
    setPrice('')
    setQuantity('1')
    setSelectedCanteenItem(null)
    setError(null)
  }

  // Canteen chip tap — stock-decrement path (already stock-tracked)
  async function handleCanteenChipTap(ci: CanteenItem) {
    if (isReadOnly || submitting) return
    const outOfStock = ci.stockEnabled && ci.currentStock === 0
    if (outOfStock) return
    setSubmitting(true)
    setError(null)
    try {
      // Peak Hour Pricing — use peak price when window is active AND item has one.
      const priceNum = getEffectivePrice(ci, peakNow, peakCfg)
      const qtyNum = 1
      const itemName = ci.name
      if (ci.stockEnabled && ci.id !== undefined) {
        const crossing = await runCanteenAddTransaction(ci, sessionId, itemName, priceNum, qtyNum)
        await fireStockToastIfNeeded(ci, crossing)
      } else {
        await runFreeformAddTransaction(sessionId, itemName, priceNum, qtyNum)
      }
      setName('')
      setPrice('')
      setQuantity('1')
      setSelectedCanteenItem(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Quick Add chip tap — match to canteen item and decrement stock
  async function handleQuickAddChipTap(itemName: string, itemPrice: number) {
    if (isReadOnly || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const priceNum = itemPrice
      const qtyNum = 1
      const ci = findMatchingCanteenItem(itemName, priceNum, canteenItems ?? [])
      if (ci && ci.stockEnabled && ci.id !== undefined) {
        const crossing = await runCanteenAddTransaction(ci, sessionId, itemName, priceNum, qtyNum)
        await fireStockToastIfNeeded(ci, crossing)
      } else {
        // Defensive fallback — chip should only appear for canteen-matched items
        await runFreeformAddTransaction(sessionId, itemName, priceNum, qtyNum)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // Manual form submit — match by name+price, show price-mismatch warning if name matches but price differs
  async function handleSubmit() {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const priceNum = Math.round(Number(price))
      const qtyNum = Math.round(Number(quantity))
      const trimmedName = name.trim()

      if (editingId !== null) {
        // Edit path — no stock change
        await updateSessionItem(editingId, { name: trimmedName, price: priceNum, quantity: qtyNum })
        setEditingId(null)
        setName('')
        setPrice('')
        setQuantity('1')
        return
      }

      // Check for exact canteen match (name + price)
      const exactMatch = findMatchingCanteenItem(trimmedName, priceNum, canteenItems ?? [])
      if (exactMatch) {
        if (exactMatch.stockEnabled && exactMatch.id !== undefined) {
          const crossing = await runCanteenAddTransaction(exactMatch, sessionId, trimmedName, priceNum, qtyNum)
          await fireStockToastIfNeeded(exactMatch, crossing)
        } else {
          await runFreeformAddTransaction(sessionId, trimmedName, priceNum, qtyNum)
        }
        setName('')
        setPrice('')
        setQuantity('1')
        setSelectedCanteenItem(null)
        setPriceWarning(null)
        setManualOpen(false)
        return
      }

      // Check for name-only match (price differs) — show inline warning (Pattern F7)
      const nameMatch = findCanteenItemByName(trimmedName, canteenItems ?? [])
      if (nameMatch) {
        setPriceWarning({ canteenItem: nameMatch })
        setSubmitting(false)
        return
      }

      // Freeform path — no canteen match
      await runFreeformAddTransaction(sessionId, trimmedName, priceNum, qtyNum)
      setName('')
      setPrice('')
      setQuantity('1')
      setSelectedCanteenItem(null)
      setPriceWarning(null)
      setManualOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  // "Use canteen price" button in price-mismatch warning
  async function handleUseCanteenPrice() {
    if (!priceWarning) return
    const ci = priceWarning.canteenItem
    const priceNum = ci.defaultPrice
    const qtyNum = Math.round(Number(quantity)) || 1
    const trimmedName = name.trim()
    setSubmitting(true)
    setError(null)
    try {
      if (ci.stockEnabled && ci.id !== undefined) {
        const crossing = await runCanteenAddTransaction(ci, sessionId, trimmedName, priceNum, qtyNum)
        await fireStockToastIfNeeded(ci, crossing)
      } else {
        await runFreeformAddTransaction(sessionId, trimmedName, priceNum, qtyNum)
      }
      setName('')
      setPrice('')
      setQuantity('1')
      setSelectedCanteenItem(null)
      setPriceWarning(null)
      setManualOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteItem(item: SessionItem) {
    try {
      await deleteSessionItem(item.id!)
      if (editingId === item.id) {
        setEditingId(null)
        setName('')
        setPrice('')
        setQuantity('1')
        setError(null)
      }
      showToast({
        message: 'Item removed',
        type: 'info',
        actionLabel: 'Undo',
        onAction: () => {
          restoreSessionItem(item).catch((err) => {
            // Toast is the only surface available here — inline slot is gone (Pattern F7 exception)
            if (err instanceof InsufficientStockError) {
              showToast({
                message: err.available > 0
                  ? `Can't restore — only ${err.available} in stock`
                  : `Can't restore — out of stock`,
                type: 'error',
              })
            } else {
              console.error(err)
            }
          })
        },
        durationMs: 5000,
      })
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : 'Could not delete item',
        type: 'error',
      })
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!open) return null

  return (
    <>
      {/* Scrim — independent fixed layer (Pattern M1) */}
      <div
        className="fixed inset-0 z-40 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — independent fixed layer (Pattern M1) */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated border-t border-border rounded-t-3xl flex flex-col"
        style={{ maxHeight: '88vh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Add item to session"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
      >
        {/* Grab handle */}
        <div className="w-10 h-1 rounded-full bg-border mx-auto mt-3 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[18px] font-extrabold tracking-tight text-text">
              {isReadOnly ? 'Session Items' : editingId !== null ? 'Edit Item' : 'Add Item'}
            </h2>
            {!isReadOnly && editingId !== null && (
              <button
                onClick={handleCancelEdit}
                className="text-[12px] text-text-dim font-medium min-h-[44px] flex items-center"
              >
                Cancel edit
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim active:text-text transition-colors rounded-xl"
            aria-label="Close"
          >
            <XIcon />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6">

          {/* Add/Edit form — hidden when completed */}
          {!isReadOnly && (
            <div className="mb-5">

              {/* 1. Canteen master-list chips — tap directly adds + decrements stock */}
              {(canteenItems ?? []).length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-2">
                    Canteen items
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {(canteenItems ?? []).map((ci) => {
                      const outOfStock = ci.stockEnabled && ci.currentStock === 0
                      const effectivePrice = getEffectivePrice(ci, peakNow, peakCfg)
                      const showPeakTag = peakActive && typeof ci.peakPrice === 'number' && ci.peakPrice > 0
                      return (
                        <button
                          key={ci.id}
                          type="button"
                          disabled={outOfStock || submitting}
                          onClick={() => handleCanteenChipTap(ci)}
                          className={`min-h-[44px] px-4 border rounded-full text-sm flex flex-col items-center justify-center shrink-0 transition-colors ${
                            outOfStock
                              ? 'bg-bg-card border-border text-text-faint opacity-50 cursor-not-allowed'
                              : 'bg-bg-card border-border text-text active:scale-95 transition-transform'
                          }`}
                        >
                          <span className="font-medium whitespace-nowrap inline-flex items-center gap-1.5">
                            {ci.name}{' '}
                            <span className={`font-mono text-xs ${showPeakTag ? 'text-paused font-bold' : 'text-text-dim'}`}>
                              ₹{effectivePrice.toLocaleString('en-IN')}
                            </span>
                            {showPeakTag && (
                              <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-paused/15 text-paused leading-none">
                                Peak
                              </span>
                            )}
                          </span>
                          {outOfStock && (
                            <span className="text-[10px] font-mono text-busy leading-none mt-0.5">
                              Out of stock
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 2. Quick Add — ONLY canteen-matched recent items */}
              {quickAddItems.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-2">
                    Quick add
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {quickAddItems.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        disabled={submitting}
                        onClick={() => handleQuickAddChipTap(item.name, item.lastPrice)}
                        className="min-h-[44px] px-4 bg-bg-card border border-border rounded-full text-text text-sm flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-40"
                      >
                        <span className="truncate max-w-[140px]">{item.name}</span>
                        <span className="text-text-dim font-mono text-xs shrink-0">
                          ₹{item.lastPrice.toLocaleString('en-IN')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. + Add other item toggle button (collapsed by default) */}
              {editingId === null && (
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => {
                      setManualOpen(v => !v)
                      setPriceWarning(null)
                      setError(null)
                    }}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 border border-dashed border-border rounded-2xl text-text-secondary text-[14px] font-medium active:bg-bg-card transition-colors"
                  >
                    {manualOpen ? (
                      <>
                        <ChevronDownIcon />
                        Hide form
                      </>
                    ) : (
                      <>
                        <PlusIcon />
                        Add other item
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* 4. Manual form — expanded when manualOpen OR editing */}
              {(manualOpen || editingId !== null) && (
                <div>
                  {/* Name input */}
                  <div className="mb-3">
                    <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                      Item Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value)
                        setSelectedCanteenItem(null)
                        setError(null)
                        setPriceWarning(null)
                      }}
                      placeholder="e.g. Cold drink, Chips, Water bottle"
                      className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
                    />
                  </div>

                  {/* Price + Quantity row */}
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                        Price (₹)
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={price}
                        onChange={(e) => {
                          setPrice(e.target.value)
                          setError(null)
                          setPriceWarning(null)
                        }}
                        placeholder="20"
                        min="0"
                        max="99999"
                        className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                        Qty
                      </label>
                      {(() => {
                        const qtyNum = Math.max(1, Math.min(99, Number(quantity) || 1))
                        const stockMax = selectedCanteenItem?.stockEnabled && selectedCanteenItem.currentStock !== null
                          ? Math.min(99, selectedCanteenItem.currentStock)
                          : 99
                        const atMax = qtyNum >= stockMax
                        const atMin = qtyNum <= 1
                        return (
                          <div className="flex items-center bg-bg border border-border rounded-xl overflow-hidden min-h-[44px]">
                            <button
                              type="button"
                              disabled={atMin}
                              onClick={() => { setQuantity(String(Math.max(1, qtyNum - 1))); setError(null) }}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors text-xl font-bold"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span className="flex-1 text-center text-[15px] font-mono font-bold text-text tabular-nums">
                              {qtyNum}
                            </span>
                            <button
                              type="button"
                              disabled={atMax}
                              onClick={() => { setQuantity(String(Math.min(stockMax, qtyNum + 1))); setError(null) }}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim disabled:opacity-30 active:bg-bg-card transition-colors text-xl font-bold"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Price-mismatch warning — inline, Pattern F7 */}
                  {priceWarning && (
                    <div className="flex items-center justify-between gap-2 mb-3 bg-bg-card border border-border rounded-xl px-4 py-3">
                      <p className="text-[13px] text-text-secondary leading-snug">
                        {priceWarning.canteenItem.name} is ₹{priceWarning.canteenItem.defaultPrice.toLocaleString('en-IN')} in canteen. Use that price?
                      </p>
                      <button
                        type="button"
                        onClick={handleUseCanteenPrice}
                        disabled={submitting}
                        className="text-[13px] text-accent font-semibold shrink-0 min-h-[36px] flex items-center disabled:opacity-40"
                      >
                        Use ₹{priceWarning.canteenItem.defaultPrice.toLocaleString('en-IN')}
                      </button>
                    </div>
                  )}

                  {/* Inline error */}
                  {error && (
                    <p className="text-busy text-[13px] mb-3">{error}</p>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || (hasInput && formError !== null) || (!hasInput)}
                    className="w-full min-h-[44px] bg-accent text-bg rounded-2xl font-bold text-[15px] disabled:opacity-40 active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
                  >
                    <PlusIcon />
                    {editingId !== null ? 'Update item' : 'Add to session'}
                  </button>
                </div>
              )}

              {/* Error shown outside manual form (e.g. canteen chip / quick-add errors) */}
              {error && !manualOpen && editingId === null && (
                <p className="text-busy text-[13px] mt-2">{error}</p>
              )}
            </div>
          )}

          {/* Read-only note for completed sessions */}
          {isReadOnly && (
            <p className="text-text-faint text-[13px] font-mono mb-4">
              This session is closed. Items can't be changed.
            </p>
          )}

          {/* 5. Items list — unchanged */}
          {items.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-2">
                {isReadOnly ? 'Items' : 'Already added'}
              </p>
              <div className="space-y-2">
                {items.map((item) => {
                  const isEditing = editingId === item.id
                  return (
                    <div
                      key={item.id}
                      onClick={() => !isReadOnly && handleStartEdit(item)}
                      className={`flex items-center gap-3 bg-bg-card border rounded-2xl px-4 py-3 transition-colors ${
                        isEditing ? 'border-accent' : 'border-border'
                      } ${!isReadOnly ? 'cursor-pointer active:bg-bg' : ''}`}
                    >
                      {/* Item info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-text truncate min-w-0 flex-1">
                          {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                        </p>
                        <p className="text-[12px] font-mono text-text-dim mt-0.5">
                          ₹{item.price.toLocaleString('en-IN')} each
                          {item.quantity > 1 && (
                            <span className="text-text-faint">
                              {' · '}₹{(item.price * item.quantity).toLocaleString('en-IN')} total
                            </span>
                          )}
                        </p>
                      </div>

                      {/* Right: total + delete */}
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-mono font-bold text-[14px] text-text tabular-nums">
                          ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                        </span>
                        {!isReadOnly && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteItem(item)
                            }}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-faint active:text-busy transition-colors rounded-xl"
                            aria-label={`Remove ${item.name}`}
                          >
                            <XIcon />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state when no items and read-only */}
          {isReadOnly && items.length === 0 && (
            <p className="text-text-faint text-[13px] font-mono">No items were added.</p>
          )}
        </div>
      </div>
    </>
  )
}
