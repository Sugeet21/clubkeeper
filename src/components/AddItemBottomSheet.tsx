import { useState, useEffect } from 'react'
import { useSessionItems, useRecentItems } from '../hooks/useLiveData'
import { addSessionItem, updateSessionItem, deleteSessionItem, restoreSessionItem } from '../db/queries'
import { useToastStore } from '../store/toastStore'
import { validateItemName } from '../lib/validation'
import type { SessionItem } from '../types'

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

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddItemBottomSheetProps {
  open: boolean
  onClose: () => void
  sessionId: number
  sessionStatus: 'running' | 'paused' | 'completed'
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
  const { show: showToast } = useToastStore()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isReadOnly = sessionStatus === 'completed'

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
      setError(null)
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
    setError(null)
  }

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
      if (editingId !== null) {
        await updateSessionItem(editingId, {
          name: name.trim(),
          price: priceNum,
          quantity: qtyNum,
        })
        setEditingId(null)
        setName('')
        setPrice('')
        setQuantity('1')
      } else {
        await addSessionItem({ sessionId, name, price: priceNum, quantity: qtyNum })
        setName('')
        setPrice('')
        setQuantity('1')
      }
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
        onAction: () => { restoreSessionItem(item).catch(console.error) },
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

              {/* Quick-add chips — only shown when there are recent items */}
              {recentItems.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-2">
                    Quick add
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {recentItems.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => {
                          setName(item.name)
                          setPrice(String(item.lastPrice))
                          setQuantity('1')
                          setEditingId(null)
                          setError(null)
                        }}
                        className="min-h-[44px] px-4 bg-bg-card border border-border rounded-full text-text text-sm flex items-center gap-2 active:scale-95 transition-transform"
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
                    setError(null)
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
                  <input
                    type="number"
                    inputMode="numeric"
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(e.target.value)
                      setError(null)
                    }}
                    placeholder="1"
                    min="1"
                    max="99"
                    className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
                  />
                </div>
              </div>

              {/* Inline error (shows form-level validation error) */}
              {error && (
                <p className="text-busy text-[13px] mb-3">{error}</p>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={submitting || (hasInput && formError !== null) || (!hasInput)}
                className="w-full min-h-[44px] bg-accent text-bg rounded-2xl font-bold text-[15px] disabled:opacity-40 active:scale-[0.99] transition-transform flex items-center justify-center gap-2"
              >
                {!hasInput ? (
                  <>
                    <PlusIcon />
                    {editingId !== null ? 'Update item' : 'Add to session'}
                  </>
                ) : formError ? (
                  editingId !== null ? 'Update item' : 'Add to session'
                ) : (
                  <>
                    <PlusIcon />
                    {editingId !== null ? 'Update item' : 'Add to session'}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Read-only note for completed sessions */}
          {isReadOnly && (
            <p className="text-text-faint text-[13px] font-mono mb-4">
              This session is closed. Items can't be changed.
            </p>
          )}

          {/* Items list */}
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
