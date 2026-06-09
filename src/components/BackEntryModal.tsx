import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from './Modal'
import { createBackEntry, BackEntryOverlapError, InsufficientStockError } from '../db/queries'
import { validateBackEntry, validateItemName } from '../lib/validation'
import { calculateAmount, calculateItemsTotal } from '../lib/money'
import { formatDuration } from '../lib/time'
import { normalizeName, findMatchingCanteenItem, findCanteenItemByName } from '../lib/canteenMatch'
import { useTables, useSettings } from '../hooks/useLiveData'
import { useToastStore } from '../store/toastStore'
import { db } from '../db/database'
import type { Session, CanteenItem, SessionItem } from '../types'

interface BackEntryModalProps {
  open: boolean
  onClose: () => void
  onSaved: (dateISO: string) => void
}

interface DraftItem {
  localId: string    // crypto.randomUUID() — React key only; never written to DB
  name: string
  price: number
  quantity: number
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export function BackEntryModal({ open, onClose, onSaved }: BackEntryModalProps) {
  const allTables = useTables()
  const settings = useSettings()

  // Active canteen items — use .filter(c => c.isActive === true), NOT .where('isActive').equals(1) (Pattern D9)
  const canteenItems = useLiveQuery(
    () => db.canteenItems.orderBy('sortOrder').filter((c) => c.isActive === true).toArray(),
    [],
    [] as CanteenItem[],
  ) ?? []

  // Only offer tables that have a ratePerHour (back entries are per_hour only)
  const eligibleTables = useMemo(
    () => allTables.filter((t) => !t.outOfService && t.ratePerHour > 0),
    [allTables],
  )

  const today = format(new Date(), 'yyyy-MM-dd')

  // ── Session fields ──────────────────────────────────────────────────────────
  const [tableId, setTableId] = useState<number | null>(null)
  const [dateStr, setDateStr] = useState(today)
  const [startTimeStr, setStartTimeStr] = useState('')
  const [endTimeStr, setEndTimeStr] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [playerCount, setPlayerCount] = useState(1)
  const [note, setNote] = useState('')

  // ── Items draft ─────────────────────────────────────────────────────────────
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [manualOpen, setManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [manualQty, setManualQty] = useState('1')
  const [manualError, setManualError] = useState<string | null>(null)
  const [priceWarning, setPriceWarning] = useState<CanteenItem | null>(null)

  // ── Form meta ───────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTableId(null)
    setDateStr(today)
    setStartTimeStr('')
    setEndTimeStr('')
    setPlayerName('')
    setPlayerCount(1)
    setNote('')
    setDraftItems([])
    setManualOpen(false)
    setManualName('')
    setManualPrice('')
    setManualQty('1')
    setManualError(null)
    setPriceWarning(null)
    setSaving(false)
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // Convert date+time strings to Unix ms (or null if incomplete)
  function toMs(date: string, time: string): number | null {
    if (!date || !time) return null
    const [y, mo, d] = date.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    if ([y, mo, d, h, mi].some((n) => isNaN(n))) return null
    return new Date(y, (mo as number) - 1, d as number, h as number, mi as number, 0, 0).getTime()
  }

  const startedAt = toMs(dateStr, startTimeStr)
  const endedAt = toMs(dateStr, endTimeStr)

  const sessionValidation = validateBackEntry({
    tableId,
    startedAt,
    endedAt,
    playerName: playerName.trim() || null,
    playerCount,
    note: note.trim() || null,
  })

  // Draft items validation
  const itemsError = useMemo((): string | null => {
    if (draftItems.length > 50) return 'Too many items (max 50)'
    for (let i = 0; i < draftItems.length; i++) {
      const d = draftItems[i]
      if (validateItemName(d.name) !== null) return `Fix item ${i + 1} name`
      if (!Number.isInteger(d.price) || d.price < 1 || d.price > 9999) return `Fix item ${i + 1} price`
      if (!Number.isInteger(d.quantity) || d.quantity < 1 || d.quantity > 99) return `Fix item ${i + 1} quantity`
    }
    return null
  }, [draftItems])

  const canSave = sessionValidation.valid && itemsError === null && !saving

  // ── Amount preview — render body only, no useLiveQuery (Pattern T4) ─────────
  const { previewDuration, previewTableAmt, previewItemsAmt, previewGrand } = useMemo(() => {
    if (!sessionValidation.valid || startedAt === null || endedAt === null || tableId === null) {
      return { previewDuration: null, previewTableAmt: null, previewItemsAmt: null, previewGrand: null }
    }
    const table = eligibleTables.find((t) => t.id === tableId)
    if (!table) return { previewDuration: null, previewTableAmt: null, previewItemsAmt: null, previewGrand: null }

    const elapsedMs = endedAt - startedAt
    const rounding = settings?.rounding ?? 'none'

    const draft: Session = {
      tableId,
      startedAt,
      endedAt,
      pausedTotalMs: 0,
      pausedAt: null,
      billingMode: 'per_hour',
      rateSnapshot: table.ratePerHour,
      playerName: playerName.trim() || null,
      playerCount,
      note: note.trim() || null,
      framesPlayed: null,
      status: 'completed',
      amount: 0,
      isBackEntry: true,
      rateCardSnapshot: table.rateCard?.length ? table.rateCard : undefined,
      toleranceMinutesSnapshot: table.rateCard?.length ? (table.toleranceMinutes ?? 10) : undefined,
      rateCardBillingSnapshot: table.rateCard?.length ? (table.rateCardBilling ?? 'prorated') : undefined,
    }

    const tableAmt = calculateAmount(draft, elapsedMs, rounding)

    // Treat draftItems as SessionItem shape for calculateItemsTotal
    const asSessionItems = draftItems.map((d) => ({
      id: undefined,
      sessionId: 0,
      name: d.name,
      price: d.price,
      quantity: d.quantity,
      addedAt: 0,
    } as SessionItem))
    const itemsAmt = calculateItemsTotal(asSessionItems)

    return {
      previewDuration: formatDuration(elapsedMs),
      previewTableAmt: tableAmt,
      previewItemsAmt: itemsAmt,
      previewGrand: tableAmt + itemsAmt,
    }
  }, [sessionValidation.valid, startedAt, endedAt, tableId, playerName, playerCount, note, eligibleTables, settings, draftItems])

  // ── Draft items helpers ─────────────────────────────────────────────────────

  function mergeDraftItem(name: string, price: number, quantity: number) {
    const normalized = normalizeName(name)
    setDraftItems((prev) => {
      const idx = prev.findIndex(
        (d) => normalizeName(d.name) === normalized && d.price === price,
      )
      if (idx !== -1) {
        return prev.map((d, i) =>
          i === idx ? { ...d, quantity: Math.min(99, d.quantity + quantity) } : d,
        )
      }
      return [...prev, { localId: crypto.randomUUID(), name: name.trim(), price, quantity }]
    })
  }

  function handleCanteenChipTap(ci: CanteenItem) {
    const outOfStock = ci.stockEnabled && (ci.currentStock ?? 0) <= 0
    if (outOfStock) return
    mergeDraftItem(ci.name, ci.defaultPrice, 1)
    setError(null)
  }

  function handleDraftQtyChange(localId: string, delta: number) {
    setDraftItems((prev) =>
      prev.flatMap((d) => {
        if (d.localId !== localId) return [d]
        const newQty = d.quantity + delta
        if (newQty < 1) return [] // remove row when decremented below 1
        return [{ ...d, quantity: Math.min(99, newQty) }]
      }),
    )
  }

  function handleDraftRemove(localId: string) {
    setDraftItems((prev) => prev.filter((d) => d.localId !== localId))
  }

  // Manual form — validate inline
  function validateManualForm(): string | null {
    const nameErr = validateItemName(manualName)
    if (nameErr) return nameErr
    const p = Number(manualPrice)
    if (!manualPrice || !Number.isInteger(p) || p < 1 || p > 9999) return 'Price must be 1–9,999'
    const q = Number(manualQty)
    if (!manualQty || !Number.isInteger(q) || q < 1 || q > 99) return 'Quantity must be 1–99'
    return null
  }

  function handleManualAdd() {
    const err = validateManualForm()
    if (err) { setManualError(err); return }

    const trimmedName = manualName.trim()
    const priceNum = Math.round(Number(manualPrice))
    const qtyNum = Math.round(Number(manualQty))

    // Check for exact canteen match (name + price) — merge if found
    const exactMatch = findMatchingCanteenItem(trimmedName, priceNum, canteenItems)
    if (exactMatch) {
      mergeDraftItem(trimmedName, priceNum, qtyNum)
      resetManualForm()
      return
    }

    // Check for name-only match (price differs) — show inline warning (Pattern F7)
    const nameMatch = findCanteenItemByName(trimmedName, canteenItems)
    if (nameMatch) {
      setPriceWarning(nameMatch)
      return
    }

    // Freeform
    mergeDraftItem(trimmedName, priceNum, qtyNum)
    resetManualForm()
  }

  function handleUseCanteenPrice() {
    if (!priceWarning) return
    const trimmedName = manualName.trim()
    const qtyNum = Math.round(Number(manualQty)) || 1
    mergeDraftItem(trimmedName, priceWarning.defaultPrice, qtyNum)
    setPriceWarning(null)
    resetManualForm()
  }

  function resetManualForm() {
    setManualName('')
    setManualPrice('')
    setManualQty('1')
    setManualError(null)
    setPriceWarning(null)
    setManualOpen(false)
  }

  // ── Save handler ────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!canSave || tableId === null || startedAt === null || endedAt === null) return
    setError(null)
    setSaving(true)
    try {
      await createBackEntry({
        tableId,
        startedAt,
        endedAt,
        playerName: playerName.trim() || null,
        playerCount,
        note: note.trim() || null,
        items: draftItems.map((d) => ({ name: d.name, price: d.price, quantity: d.quantity })),
      })
      const grand = previewGrand ?? 0
      useToastStore.getState().show(`Past session logged · ₹${grand.toLocaleString('en-IN')}`, 'success')
      onSaved(dateStr)
      reset()
    } catch (err) {
      if (err instanceof BackEntryOverlapError) {
        const c = err.conflictingSession
        const cEnd = c.endedAt ?? Date.now()
        setError(
          `Overlaps with session at ${format(c.startedAt, 'h:mm a')}–${format(cEnd, 'h:mm a')} on this table`,
        )
      } else if (err instanceof InsufficientStockError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Could not save back entry. Please try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────────

  const footer = (
    <div className="space-y-2">
      {(error || itemsError) && (
        <p className="text-[13px] text-busy">{error ?? itemsError}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleClose}
          className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold min-h-[44px]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-50 min-h-[44px]"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )

  return (
    <Modal open={open} onClose={handleClose} title="Log past session" footer={footer}>
      <div className="space-y-4 pb-2">

        {/* Table */}
        <Field label="Table">
          <select
            value={tableId ?? ''}
            onChange={(e) => { setTableId(e.target.value ? Number(e.target.value) : null); setError(null) }}
            className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] focus:border-accent focus:outline-none [color-scheme:dark]"
          >
            <option value="">Select table…</option>
            {eligibleTables.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        {/* Date */}
        <Field label="Date">
          <input
            type="date"
            value={dateStr}
            max={today}
            onChange={(e) => { if (e.target.value) { setDateStr(e.target.value); setError(null) } }}
            className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
          />
        </Field>

        {/* Start / End time — side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input
              type="time"
              value={startTimeStr}
              onChange={(e) => { setStartTimeStr(e.target.value); setError(null) }}
              className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
            />
          </Field>
          <Field label="End">
            <input
              type="time"
              value={endTimeStr}
              onChange={(e) => { setEndTimeStr(e.target.value); setError(null) }}
              className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
            />
          </Field>
        </div>

        {/* Player name */}
        <Field label="Player Name (optional)">
          <input
            type="text"
            value={playerName}
            onChange={(e) => { setPlayerName(e.target.value); setError(null) }}
            placeholder="e.g. Rahul"
            className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
          />
        </Field>

        {/* Player count — +/- stepper */}
        <Field label="Player Count">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPlayerCount((n) => Math.max(1, n - 1))}
              disabled={playerCount <= 1}
              className="w-11 h-11 flex items-center justify-center bg-bg border border-border rounded-xl text-text text-[20px] font-bold disabled:opacity-40"
            >
              −
            </button>
            <span className="text-[18px] font-bold text-text w-8 text-center tabular-nums">{playerCount}</span>
            <button
              onClick={() => setPlayerCount((n) => Math.min(20, n + 1))}
              disabled={playerCount >= 20}
              className="w-11 h-11 flex items-center justify-center bg-bg border border-border rounded-xl text-text text-[20px] font-bold disabled:opacity-40"
            >
              +
            </button>
          </div>
        </Field>

        {/* Note */}
        <Field label="Note (optional)">
          <textarea
            value={note}
            onChange={(e) => { setNote(e.target.value); setError(null) }}
            placeholder="Any note…"
            rows={2}
            className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors resize-none"
          />
        </Field>

        {/* ── Items section ──────────────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">
            Items (optional)
          </p>

          {/* Canteen chips */}
          {canteenItems.length > 0 && (
            <div className="mb-3">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {canteenItems.map((ci) => {
                  const outOfStock = ci.stockEnabled && (ci.currentStock ?? 0) <= 0
                  return (
                    <button
                      key={ci.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => handleCanteenChipTap(ci)}
                      className={`min-h-[44px] px-4 border rounded-full text-sm flex flex-col items-center justify-center shrink-0 transition-colors ${
                        outOfStock
                          ? 'bg-bg-card border-border text-text-faint opacity-50 cursor-not-allowed'
                          : 'bg-bg-card border-border text-text active:scale-95 transition-transform'
                      }`}
                    >
                      <span className="font-medium whitespace-nowrap">
                        {ci.name}{' '}
                        <span className="font-mono text-text-dim text-xs">
                          ₹{ci.defaultPrice.toLocaleString('en-IN')}
                        </span>
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

          {/* Draft items list */}
          {draftItems.length > 0 && (
            <div className="space-y-2 mb-3">
              {draftItems.map((d) => (
                <div
                  key={d.localId}
                  className="flex items-center gap-2 bg-bg-card border border-border rounded-2xl px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text truncate">{d.name}</p>
                    <p className="text-[11px] font-mono text-text-dim">₹{d.price.toLocaleString('en-IN')} each</p>
                  </div>
                  {/* qty stepper */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDraftQtyChange(d.localId, -1)}
                      className="w-8 h-8 flex items-center justify-center bg-bg border border-border rounded-lg text-text font-bold text-[16px] min-h-[44px] min-w-[44px]"
                    >
                      −
                    </button>
                    <span className="text-[14px] font-bold text-text w-6 text-center tabular-nums">{d.quantity}</span>
                    <button
                      onClick={() => handleDraftQtyChange(d.localId, 1)}
                      disabled={d.quantity >= 99}
                      className="w-8 h-8 flex items-center justify-center bg-bg border border-border rounded-lg text-text font-bold text-[16px] disabled:opacity-40 min-h-[44px] min-w-[44px]"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[13px] font-bold text-text tabular-nums shrink-0 w-14 text-right">
                    ₹{(d.price * d.quantity).toLocaleString('en-IN')}
                  </span>
                  <button
                    onClick={() => handleDraftRemove(d.localId)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-faint active:text-busy rounded-xl"
                    aria-label={`Remove ${d.name}`}
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* + Add other item toggle */}
          <button
            type="button"
            onClick={() => { setManualOpen((v) => !v); setPriceWarning(null); setManualError(null) }}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 border border-dashed border-border rounded-2xl text-text-dim text-[14px] font-medium active:bg-bg-card transition-colors mb-2"
          >
            {manualOpen ? 'Hide form' : '+ Add other item'}
          </button>

          {/* Manual add form */}
          {manualOpen && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                  Item Name
                </label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => { setManualName(e.target.value); setManualError(null); setPriceWarning(null) }}
                  placeholder="e.g. Cold drink, Chips"
                  className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                    Price (₹)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={manualPrice}
                    onChange={(e) => { setManualPrice(e.target.value); setManualError(null); setPriceWarning(null) }}
                    placeholder="20"
                    min="1"
                    max="9999"
                    className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1.5">
                    Qty
                  </label>
                  <div className="flex items-center bg-bg border border-border rounded-xl overflow-hidden min-h-[44px]">
                    <button
                      type="button"
                      onClick={() => setManualQty((v) => String(Math.max(1, Number(v) - 1)))}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim active:bg-bg-card text-xl font-bold"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center text-[15px] font-mono font-bold text-text tabular-nums">
                      {Math.max(1, Math.min(99, Number(manualQty) || 1))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setManualQty((v) => String(Math.min(99, Number(v) + 1)))}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim active:bg-bg-card text-xl font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Price-mismatch warning — inline Pattern F7 */}
              {priceWarning && (
                <div className="flex items-center justify-between gap-2 bg-bg-card border border-border rounded-xl px-4 py-3">
                  <p className="text-[13px] text-paused leading-snug">
                    {priceWarning.name} is ₹{priceWarning.defaultPrice.toLocaleString('en-IN')} in canteen. Use that price?
                  </p>
                  <button
                    type="button"
                    onClick={handleUseCanteenPrice}
                    className="text-[13px] text-accent font-semibold shrink-0 min-h-[36px] flex items-center"
                  >
                    Use ₹{priceWarning.defaultPrice.toLocaleString('en-IN')}
                  </button>
                </div>
              )}

              {manualError && (
                <p className="text-busy text-[13px]">{manualError}</p>
              )}

              <button
                type="button"
                onClick={handleManualAdd}
                className="w-full min-h-[44px] bg-accent text-bg rounded-2xl font-bold text-[15px] active:scale-[0.99] transition-transform"
              >
                Add to session
              </button>
            </div>
          )}
        </div>

        {/* Preview block — Pattern T4, render body only */}
        <div className="bg-bg-card border border-border rounded-2xl px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Duration</span>
            <span className="text-[14px] font-semibold text-text tabular-nums">
              {previewDuration ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Table Amt</span>
            <span className="text-[14px] font-semibold text-text tabular-nums">
              {previewTableAmt !== null ? `₹${previewTableAmt.toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
          {draftItems.length > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Items</span>
              <span className="text-[14px] font-semibold text-text tabular-nums">
                {previewItemsAmt !== null ? `₹${previewItemsAmt.toLocaleString('en-IN')}` : '—'}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border pt-1.5 mt-0.5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Grand Total</span>
            <span className="text-[15px] font-bold text-accent tabular-nums">
              {previewGrand !== null ? `₹${previewGrand.toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
        </div>

      </div>
    </Modal>
  )
}
